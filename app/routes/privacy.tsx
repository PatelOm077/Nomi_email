import { LEGAL_CONTACT, LegalPage, legalLinks, legalMeta } from "../components/legal-page";

export const meta = () =>
  legalMeta("Privacy policy", "What personal data Nomi processes for Shopify merchants and their customers, and why.");
export const links = legalLinks;

export default function Privacy() {
  return (
    <LegalPage
      kicker="Nomi · Privacy"
      title="Privacy policy"
      lede="Nomi is a Shopify app that designs and sends a store’s lifecycle emails. This page explains what data Nomi handles, why, and for how long."
    >
      <h2>Who we are</h2>
      <p>
        Nomi is built and operated by Om Barvaliya (“Nomi”, “we”). Questions or requests about this policy go to{" "}
        <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
      </p>
      <p>
        For the personal data of a store’s customers, the merchant who installs Nomi is the controller and Nomi
        is their processor: we only use that data to provide Nomi to that merchant, under our{" "}
        <a href="/terms#dpa">data processing agreement</a>. For the merchant’s own account data, Nomi is the
        controller.
      </p>

      <h2>What we collect</h2>
      <h3>From merchants</h3>
      <ul>
        <li>The store’s Shopify domain, name, and the Shopify access token that lets Nomi work in the store.</li>
        <li>
          Store and catalogue details Nomi reads to design emails: products, collections, theme colours, logo and
          public website content.
        </li>
        <li>Settings the merchant enters: sender name and address, language, tone, brand choices, plan and usage.</li>
        <li>Support conversations in the Nomi help chat, and the email address the merchant leaves for a reply.</li>
      </ul>
      <h3>About the merchant’s customers</h3>
      <ul>
        <li>Email address and first name.</li>
        <li>Email marketing consent status.</li>
        <li>
          Abandoned checkout and order details needed for an email: items, prices, checkout link, and delivery
          status.
        </li>
        <li>Whether an email Nomi sent was delivered, opened or clicked, and whether an order followed it.</li>
      </ul>
      <p>
        Nomi does not collect customers’ phone numbers, postal addresses, payment details, or browsing behaviour,
        and does not use cookies or tracking pixels on the storefront.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To design the store’s emails and send abandoned-cart recovery and review-request emails.</li>
        <li>
          To send marketing email only to customers who consented, and never again to anyone who unsubscribed,
          bounced, or complained.
        </li>
        <li>To show the merchant how their emails perform and which sales they led to.</li>
        <li>To run the help chat, answer support requests, and apply the merchant’s plan limits.</li>
      </ul>
      <p>
        We don’t sell personal data, don’t use it for advertising, and don’t use it to make decisions with legal
        or similarly significant effects about anyone. Customer data from one store is never used for another.
      </p>

      <h2>Who we share it with</h2>
      <p>Nomi uses these service providers (sub-processors), each only for the purpose listed:</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Provider</th><th>Purpose</th><th>Personal data involved</th></tr>
          </thead>
          <tbody>
            <tr><td>Shopify</td><td>Platform the app runs in</td><td>Store and customer data, as the source</td></tr>
            <tr><td>Fly.io (Amsterdam, Netherlands)</td><td>Hosting and database</td><td>All data Nomi stores</td></tr>
            <tr><td>Resend</td><td>Delivering emails</td><td>Customer email address and the email content</td></tr>
            <tr><td>Anthropic</td><td>AI email writing and the help chat</td><td>Store content; a customer’s first name and cart items when an email is written for that customer; support messages</td></tr>
            <tr><td>OpenAI</td><td>AI product photography</td><td>Product images and descriptions only, no customer data</td></tr>
            <tr><td>remove.bg</td><td>Product photo cut-outs (optional)</td><td>Product images only, no customer data</td></tr>
          </tbody>
        </table>
      </div>
      <p>We may also disclose data where the law requires it.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Customer email records (address, cart, delivery results): deleted 180 days after they are created.</li>
        <li>Unsubscribed or bounced addresses: kept only so that address is never emailed again.</li>
        <li>Access logs of the support inbox: one year.</li>
        <li>Database backups: seven daily copies, each replaced after a week.</li>
        <li>
          When a merchant uninstalls Nomi, sessions, settings, queued emails and support chats are deleted at once,
          and everything else for that store is deleted when Shopify sends its shop deletion request 48 hours later.
        </li>
        <li>
          When a merchant or Shopify asks us to delete a customer’s data, we delete that customer’s email records.
        </li>
      </ul>

      <h2>How we protect it</h2>
      <ul>
        <li>All traffic uses HTTPS. Stored data and backups are on encrypted disks.</li>
        <li>Access to the server and databases is limited to Nomi’s operator, with strong, unique credentials.</li>
        <li>Shopify webhooks are verified by signature; secrets are kept in the host’s secret store, not in code.</li>
        <li>Access to support data is logged. We follow a written incident response plan and tell affected merchants without undue delay, within 72 hours of confirming an incident.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Customers of a store: please contact the store first, since it controls your data. Shopify passes your
        access and deletion requests to Nomi, and we act on them. Merchants, or anyone else whose data Nomi holds,
        can ask us at <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a> to access, correct, delete or export
        it. Depending on where you live, you may also complain to your data protection authority.
      </p>

      <h2>International transfers</h2>
      <p>
        Nomi is hosted in the Netherlands. Some providers above process data in the United States; where needed we
        rely on their standard contractual clauses or equivalent safeguards.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that matters, we’ll update the date above and tell merchants in the app.
      </p>
    </LegalPage>
  );
}
