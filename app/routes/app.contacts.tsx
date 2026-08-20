// Contacts — a real, paginated list of the shop's Shopify customers.
// Mirrors the Campaigns page shell (same nomi-flow-page/-header/-title) so
// every dashboard page reads as one product; see CLAUDE.md's brand section
// for why the stats below stay within ink/cyan/neutral rather than adding
// a status color the design mock used (Nomi's own UI keeps to cyan as the
// only interaction color, magenta reserved as a single spot accent — see
// DECISIONS.md, 2026-08-17).
//
// "Manage contacts" is deliberately inert: bulk contact management is
// segmentation/settings-sprawl territory SPEC.md rules out of v1, so the
// button stays disabled rather than pointing at a page that doesn't exist.
import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

const CONTACTS_PAGE_SIZE = 12;

const CONTACTS_LIST_QUERY = `#graphql
  query ContactsList($first: Int, $last: Int, $after: String, $before: String, $query: String) {
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
  }
`;

const CONTACTS_COUNTS_QUERY = `#graphql
  query ContactsCounts($matchedQuery: String) {
    total: customersCount {
      count
    }
    active: customersCount(query: "accepts_marketing:true") {
      count
    }
    suppressed: customersCount(query: "accepts_marketing:false") {
      count
    }
    matched: customersCount(query: $matchedQuery) {
      count
    }
  }
`;

type ContactNode = {
  id: string;
  displayName: string;
  defaultEmailAddress: { emailAddress: string } | null;
  createdAt: string;
};

type ContactsListResponse = {
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
  };
};

type ContactsCountsResponse = {
  data: {
    total: { count: number };
    active: { count: number };
    suppressed: { count: number };
    matched: { count: number };
  };
};

// Deterministic, locale-independent — matches the "YYYY-MM-DD · HH:MM"
// ledger format regardless of the merchant's browser locale.
function formatContactDate(iso: string) {
  const isoStamp = new Date(iso).toISOString();
  return `${isoStamp.slice(0, 10)} · ${isoStamp.slice(11, 16)}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || "";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  const listVariables = before
    ? { last: CONTACTS_PAGE_SIZE, before, query: search || null }
    : { first: CONTACTS_PAGE_SIZE, after: after || null, query: search || null };

  const [listResponse, countsResponse] = await Promise.all([
    admin.graphql(CONTACTS_LIST_QUERY, { variables: listVariables }),
    admin.graphql(CONTACTS_COUNTS_QUERY, { variables: { matchedQuery: search || null } }),
  ]);

  const { data: listData } = (await listResponse.json()) as ContactsListResponse;
  const { data: countsData } = (await countsResponse.json()) as ContactsCountsResponse;

  const contacts = listData.customers.edges.map(({ node }) => ({
    id: node.id,
    name: node.displayName,
    email: node.defaultEmailAddress?.emailAddress ?? null,
    createdAt: node.createdAt,
  }));

  return {
    search,
    contacts,
    pageInfo: listData.customers.pageInfo,
    counts: {
      total: countsData.total.count,
      active: countsData.active.count,
      suppressed: countsData.suppressed.count,
      matched: countsData.matched.count,
    },
  };
};

export default function ContactsPage() {
  const { search, contacts, pageInfo, counts } = useLoaderData<typeof loader>();

  const nextParams = new URLSearchParams();
  if (search) nextParams.set("q", search);
  if (pageInfo.endCursor) nextParams.set("after", pageInfo.endCursor);

  const prevParams = new URLSearchParams();
  if (search) prevParams.set("q", search);
  if (pageInfo.startCursor) prevParams.set("before", pageInfo.startCursor);

  return (
    <main className="nomi-flow-page nomi-contacts-page">
      <div className="nomi-flow-shell">
        <header className="nomi-flow-header">
          <div className="nomi-flow-title">
            <span className="nomi-flow-reference-arrow" aria-hidden="true">←</span>
            <h1>Contacts</h1>
          </div>
        </header>

        <section className="nomi-contacts-stats" aria-label="Contact totals">
          <div className="nomi-contacts-stat">
            <span className="nomi-contacts-stat-label">Total contacts</span>
            <span className="nomi-contacts-stat-value nomi-contacts-stat-value--accent">{counts.total}</span>
          </div>
          <div className="nomi-contacts-stat">
            <span className="nomi-contacts-stat-label">Active contacts</span>
            <span className="nomi-contacts-stat-value">{counts.active}</span>
          </div>
          <div className="nomi-contacts-stat">
            <span className="nomi-contacts-stat-label">Suppressed contacts</span>
            <span className="nomi-contacts-stat-value nomi-contacts-stat-value--muted">{counts.suppressed}</span>
          </div>
        </section>

        <Form method="get" className="nomi-contacts-toolbar" role="search">
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search contacts"
            className="nomi-contacts-search nomi-cursor-loupe"
            aria-label="Search contacts"
          />
          <button
            type="button"
            className="nomi-brand-link nomi-contacts-manage"
            disabled
            title="Contact management is coming in a later release"
          >
            Manage contacts
          </button>
        </Form>

        <section className="nomi-contacts-table-card" aria-label="Contact list">
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
                <tr>
                  <td colSpan={4} className="nomi-contacts-empty">
                    {search ? `No contacts match "${search}."` : "No contacts yet."}
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => (
                  <tr key={contact.id} className="nomi-cursor-manicule">
                    <td className="nomi-contacts-name">{contact.name}</td>
                    <td className="nomi-contacts-email">
                      {contact.email ?? <span className="nomi-contacts-muted">No email on file</span>}
                    </td>
                    <td className="nomi-contacts-muted">Shopify</td>
                    <td className="nomi-contacts-date">{formatContactDate(contact.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="nomi-contacts-pagination">
            {pageInfo.hasPreviousPage ? (
              <Link
                to={`?${prevParams.toString()}`}
                className="nomi-contacts-page-btn nomi-cursor-manicule"
                aria-label="Previous page"
                prefetch="intent"
              >
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4 L5 10 L11 16" />
                </svg>
              </Link>
            ) : (
              <button type="button" className="nomi-contacts-page-btn" aria-label="Previous page" disabled>
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4 L5 10 L11 16" />
                </svg>
              </button>
            )}

            <span className="nomi-contacts-page-count">
              {contacts.length === 0
                ? "0 contacts"
                : `${contacts.length} of ${counts.matched} contact${counts.matched === 1 ? "" : "s"}`}
            </span>

            {pageInfo.hasNextPage ? (
              <Link
                to={`?${nextParams.toString()}`}
                className="nomi-contacts-page-btn nomi-cursor-manicule"
                aria-label="Next page"
                prefetch="intent"
              >
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 4 L15 10 L9 16" />
                </svg>
              </Link>
            ) : (
              <button type="button" className="nomi-contacts-page-btn" aria-label="Next page" disabled>
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 4 L15 10 L9 16" />
                </svg>
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
