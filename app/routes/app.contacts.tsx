// Contacts — a real, paginated list of the shop's Shopify customers.
// Deliberately does NOT use the shared nomi-flow-page/-header/-title shell
// or Nomi's --nomi-* brand tokens — this page is a from-scratch match of
// the originally pasted design mock (its own layout, palette, and type
// system: Source Serif 4 for display moments, IBM Plex Sans for UI chrome,
// IBM Plex Mono for email/date data), overriding CLAUDE.md's brand
// section / DECISIONS.md's 2026-08-17 newsprint-plain call on this page
// only, per an explicit, repeated direction to match the mock exactly
// rather than reconcile it with the rest of the app.
//
// Customer creation is handled by this route's authenticated action. The
// write_customers scope is declared alongside read_customers in app config.
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, data, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const CONTACTS_PAGE_SIZE = 12;

const CONTACTS_DASHBOARD_QUERY = `#graphql
  query ContactsDashboard(
    $first: Int
    $last: Int
    $after: String
    $before: String
    $query: String
    $matchedQuery: String
    $activeQuery: String!
  ) {
    customers(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          displayName
          defaultEmailAddress {
            emailAddress
          }
          createdAt
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
    total: customersCount {
      count
    }
    active: customersCount(query: $activeQuery) {
      count
    }
    matched: customersCount(query: $matchedQuery) {
      count
    }
  }
`;

// This is Shopify's supported customer-search filter for subscribers. It
// lets the count run on Shopify's index instead of downloading customer
// records merely to derive a dashboard total.
const ACTIVE_CONTACTS_QUERY = "email_marketing_state:SUBSCRIBED";

const CREATE_CONTACT_MUTATION = `#graphql
  mutation CreateContact($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
`;

type ContactFilter = "all" | "active" | "suppressed";

function contactQuery(search: string, filter: ContactFilter) {
  const parts = [search];
  if (filter === "active") parts.push(ACTIVE_CONTACTS_QUERY);
  if (filter === "suppressed") parts.push(`-${ACTIVE_CONTACTS_QUERY}`);
  return parts.filter(Boolean).join(" ") || null;
}

type ContactNode = {
  id: string;
  displayName: string;
  defaultEmailAddress: { emailAddress: string } | null;
  createdAt: string;
};

type ContactsDashboardResponse = {
  data: {
    customers: {
      edges: Array<{ cursor: string; node: ContactNode }>;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
      };
    };
    total: { count: number };
    active: { count: number };
    matched: { count: number };
  };
};

type ContactsLoaderData = {
  search: string;
  filter: ContactFilter;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    createdAt: string;
  }>;
  pageInfo: ContactsDashboardResponse["data"]["customers"]["pageInfo"];
  counts: {
    total: number;
    active: number;
    suppressed: number;
    matched: number;
  };
};

const CONTACTS_CACHE_TTL_MS = 30_000;
const contactsCache = new Map<
  string,
  { expiresAt: number; value: ContactsLoaderData }
>();

// Deterministic, locale-independent — matches the "YYYY-MM-DD · HH:MM"
// ledger format regardless of the merchant's browser locale.
function formatContactDate(iso: string) {
  const isoStamp = new Date(iso).toISOString();
  return `${isoStamp.slice(0, 10)} · ${isoStamp.slice(11, 16)}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || "";
  const requestedFilter = url.searchParams.get("filter");
  const filter: ContactFilter = requestedFilter === "active" || requestedFilter === "suppressed" ? requestedFilter : "all";
  const query = contactQuery(search, filter);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const cacheKey = `${session.shop}:${url.search}`;
  const cached = contactsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const listVariables = before
    ? { last: CONTACTS_PAGE_SIZE, before, query }
    : { first: CONTACTS_PAGE_SIZE, after: after || null, query };

  const response = await admin.graphql(CONTACTS_DASHBOARD_QUERY, {
    variables: {
      ...listVariables,
      matchedQuery: query,
      activeQuery: ACTIVE_CONTACTS_QUERY,
    },
  });
  const { data } = (await response.json()) as ContactsDashboardResponse;

  const contacts = data.customers.edges.map(({ node }) => ({
    id: node.id,
    name: node.displayName,
    email: node.defaultEmailAddress?.emailAddress ?? null,
    createdAt: node.createdAt,
  }));

  const total = data.total.count;
  const active = data.active.count;

  const loaderData: ContactsLoaderData = {
    search,
    filter,
    contacts,
    pageInfo: data.customers.pageInfo,
    counts: {
      total,
      active,
      suppressed: total - active,
      matched: data.matched.count,
    },
  };

  contactsCache.set(cacheKey, {
    expiresAt: Date.now() + CONTACTS_CACHE_TTL_MS,
    value: loaderData,
  });

  return loaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "create-contact") {
    return data({ error: "That contact action is not supported." }, { status: 400 });
  }

  const firstName = String(form.get("firstName") ?? "").trim();
  const lastName = String(form.get("lastName") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const subscribed = form.get("subscribed") === "on";

  if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    return data({ error: "Enter a valid email address." }, { status: 422 });
  }
  if (firstName.length > 255 || lastName.length > 255) {
    return data({ error: "Keep names under 256 characters." }, { status: 422 });
  }

  // Name and email only: Nomi's protected customer data access covers those
  // two fields, not phone or address.
  const input: Record<string, unknown> = { email };
  if (firstName) input.firstName = firstName;
  if (lastName) input.lastName = lastName;
  if (subscribed) {
    input.emailMarketingConsent = {
      marketingState: "SUBSCRIBED",
      marketingOptInLevel: "SINGLE_OPT_IN",
      consentUpdatedAt: new Date().toISOString(),
    };
  }

  const response = await admin.graphql(CREATE_CONTACT_MUTATION, { variables: { input } });
  const result = (await response.json()) as {
    data?: { customerCreate?: { customer: { id: string } | null; userErrors: Array<{ message: string }> } };
    errors?: Array<{ message: string }>;
  };
  const payload = result.data?.customerCreate;
  const error = payload?.userErrors[0]?.message ?? result.errors?.[0]?.message;
  if (!payload?.customer || error) {
    return data({ error: error ?? "Shopify could not create this contact." }, { status: 422 });
  }

  for (const key of contactsCache.keys()) {
    if (key.startsWith(`${session.shop}:`)) contactsCache.delete(key);
  }
  return redirect("/app/contacts?created=1");
};

export default function ContactsPage() {
  const { search, filter, contacts, pageInfo, counts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const isCreating = navigation.state === "submitting" && navigation.formData?.get("intent") === "create-contact";
  const [showAddContact, setShowAddContact] = useState(Boolean(actionData?.error));
  useEffect(() => { if (actionData?.error) setShowAddContact(true); }, [actionData]);

  const nextParams = new URLSearchParams();
  if (search) nextParams.set("q", search);
  if (filter !== "all") nextParams.set("filter", filter);
  if (pageInfo.endCursor) nextParams.set("after", pageInfo.endCursor);

  const prevParams = new URLSearchParams();
  if (search) prevParams.set("q", search);
  if (filter !== "all") prevParams.set("filter", filter);
  if (pageInfo.startCursor) prevParams.set("before", pageInfo.startCursor);

  return (
    <main className="nomi-contacts-page">
      <div className="nomi-contacts-topbar">
        <div className="nomi-contacts-topbar-left">
          <Link to="/app" className="nomi-contacts-back-btn" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 10H5M9 6l-4 4 4 4" />
            </svg>
          </Link>
          <h1 className="nomi-contacts-title">Contacts</h1>
        </div>
        <button
          type="button"
          className="nomi-contacts-add-btn"
          onClick={() => setShowAddContact(true)}
        >
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M10 4v12M4 10h12" />
          </svg>
          Add contact
        </button>
      </div>

      <section className="nomi-contacts-stats" aria-label="Contact totals">
        <div className="nomi-contacts-stat nomi-contacts-stat--total">
          <span className="nomi-contacts-stat-badge nomi-contacts-stat-badge--total">{counts.total}</span>
          <div className="nomi-contacts-stat-copy">
            <span className="nomi-contacts-stat-label">Total contacts</span>
            <span className="nomi-contacts-stat-value">All time</span>
          </div>
        </div>
        <div className="nomi-contacts-stat nomi-contacts-stat--active">
          <span className="nomi-contacts-stat-badge nomi-contacts-stat-badge--active">{counts.active}</span>
          <div className="nomi-contacts-stat-copy">
            <span className="nomi-contacts-stat-label">Active</span>
            <span className="nomi-contacts-stat-value">Subscribed</span>
          </div>
        </div>
        <div className="nomi-contacts-stat nomi-contacts-stat--suppressed">
          <span className="nomi-contacts-stat-badge nomi-contacts-stat-badge--suppressed">{counts.suppressed}</span>
          <div className="nomi-contacts-stat-copy">
            <span className="nomi-contacts-stat-label">Suppressed</span>
            <span className="nomi-contacts-stat-value">Excluded from sends</span>
          </div>
        </div>
      </section>

      <section className="nomi-contacts-table-card" aria-label="Contact list">
        <div className="nomi-contacts-table-card-head">
          <h2>All contacts</h2>
          <div className="nomi-contacts-table-tools">
            <Form method="get" className="nomi-contacts-search-wrap" role="search">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="M13 13l4 4" strokeLinecap="round" />
              </svg>
              <label htmlFor="contacts-search" className="nomi-visually-hidden">Search contacts</label>
              <input
                id="contacts-search"
                type="search"
                name="q"
                defaultValue={search}
                placeholder="Search name or email"
                className="nomi-contacts-search-input nomi-cursor-loupe"
                aria-label="Search contacts"
              />
              {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
            </Form>
            <Form method="get">
              {search ? <input type="hidden" name="q" value={search} /> : null}
              <label className="nomi-visually-hidden" htmlFor="contacts-filter">Filter contacts</label>
              <select id="contacts-filter" name="filter" value={filter} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="nomi-contacts-filter" aria-label="Filter contacts">
                <option value="all">All contacts</option>
                <option value="active">Subscribed</option>
                <option value="suppressed">Suppressed</option>
              </select>
            </Form>
          </div>
        </div>

        <div className="nomi-table-responsive-wrap" aria-busy={isLoading}>
          <table className="nomi-contacts-table">
            <colgroup>
              <col style={{ width: "26%" }} />
              <col style={{ width: "34%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "24%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Contact name</th>
                <th>Email</th>
                <th>Source</th>
                <th>Contact created</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td><div className="nomi-skeleton nomi-skeleton-text" /></td>
                      <td><div className="nomi-skeleton nomi-skeleton-text" /></td>
                      <td><div className="nomi-skeleton nomi-skeleton-text" /></td>
                      <td><div className="nomi-skeleton nomi-skeleton-text" /></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="nomi-contacts-empty">
                      {search ? `No contacts match "${search}."` : "No contacts yet."}
                    </td>
                  </tr>
                )
              ) : (
              contacts.map((contact) => (
                <tr key={contact.id} className="nomi-cursor-manicule">
                  <td className="nomi-contacts-name">{contact.name}</td>
                  <td className="nomi-contacts-email">
                    {contact.email ?? <span className="nomi-contacts-muted">No email on file</span>}
                  </td>
                  <td>
                    <span className="nomi-contacts-source-pill">Shopify</span>
                  </td>
                  <td className="nomi-contacts-date">{formatContactDate(contact.createdAt)}</td>
                </tr>
              ))
            )}
            </tbody>
          </table>
        </div>

        <div className="nomi-contacts-pagination">
          <span className="nomi-contacts-page-count">
            {contacts.length === 0
              ? "0 contacts"
              : `${contacts.length} of ${counts.matched} contact${counts.matched === 1 ? "" : "s"}`}
          </span>

          <div className="nomi-contacts-pager-buttons">
            {pageInfo.hasPreviousPage ? (
              <Link
                to={`?${prevParams.toString()}`}
                className="nomi-contacts-page-btn nomi-cursor-manicule"
                aria-label="Previous page"
                prefetch="intent"
                aria-disabled={isLoading}
              >
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4 L5 10 L11 16" />
                </svg>
              </Link>
            ) : (
              <button type="button" className="nomi-contacts-page-btn" aria-label="Previous page" disabled>
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4 L5 10 L11 16" />
                </svg>
              </button>
            )}

            {pageInfo.hasNextPage ? (
              <Link
                to={`?${nextParams.toString()}`}
                className="nomi-contacts-page-btn nomi-cursor-manicule"
                aria-label="Next page"
                prefetch="intent"
                aria-disabled={isLoading}
              >
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 4 L15 10 L9 16" />
                </svg>
              </Link>
            ) : (
              <button type="button" className="nomi-contacts-page-btn" aria-label="Next page" disabled>
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 4 L15 10 L9 16" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </section>
      {showAddContact ? (
        <div className="nomi-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !isCreating) setShowAddContact(false); }}>
          <section className="nomi-dialog nomi-contact-dialog" role="dialog" aria-modal="true" aria-labelledby="add-contact-title">
            <header><div><span>Shopify customer</span><h2 id="add-contact-title">Add a contact</h2></div><button type="button" onClick={() => setShowAddContact(false)} disabled={isCreating} aria-label="Close add contact dialog">×</button></header>
            <Form method="post">
              <input type="hidden" name="intent" value="create-contact" />
              {actionData?.error ? <p className="nomi-form-error" role="alert">{actionData.error}</p> : null}
              <div className="nomi-dialog-field-row"><label><span>First name</span><input name="firstName" maxLength={255} autoComplete="given-name" /></label><label><span>Last name</span><input name="lastName" maxLength={255} autoComplete="family-name" /></label></div>
              <label><span>Email</span><input name="email" type="email" maxLength={254} required autoComplete="email" /></label>
              <label className="nomi-dialog-checkbox"><input name="subscribed" type="checkbox" /><span>This person gave permission to receive marketing email.</span></label>
              <footer><button type="button" className="nomi-dialog-secondary" onClick={() => setShowAddContact(false)} disabled={isCreating}>Cancel</button><button className="nomi-dialog-primary" disabled={isCreating}>{isCreating ? "Adding…" : "Add contact"}</button></footer>
            </Form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
