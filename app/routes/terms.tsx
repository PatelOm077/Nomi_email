import { LEGAL_CONTACT, LegalPage, legalLinks, legalMeta } from "../components/legal-page";

export const meta = () =>
  legalMeta("Terms and data processing agreement", "The terms for using Nomi, including how Nomi processes customer data on a merchant’s behalf.");
export const links = legalLinks;

export default function Terms() {
  return (
    <LegalPage
      kicker="Nomi · Terms"
      title="Terms and data processing agreement"
      lede="These terms apply when a merchant installs Nomi. By installing or using Nomi you agree to them, including the data processing agreement below."
    >
      <h2>The service</h2>
      <p>
        Nomi designs a store’s lifecycle emails with AI and sends abandoned-cart and review-request emails for
        it. Features and limits depend on the plan chosen in the app. Paid plans are billed by Shopify, on
        Shopify’s billing terms.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Only email customers you’re allowed to email, and keep your store’s consent records accurate.</li>
        <li>
          Review emails before turning sending on. AI-written content can contain mistakes; you’re responsible for
          what your store sends, including prices, offers and claims.
        </li>
        <li>Don’t use Nomi to send spam, unlawful content, or content you don’t have rights to.</li>
        <li>Give your customers a privacy notice that covers email marketing and service providers like Nomi.</li>
      </ul>

      <h2>Availability and changes</h2>
      <p>
        We work to keep Nomi available and correct, but provide it “as is”. We may change or discontinue features;
        if we end the service we’ll give reasonable notice. You can uninstall at any time, which ends these terms
        and starts the data deletion described in our <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, Nomi isn’t liable for indirect or consequential losses, and our total
        liability is limited to the fees you paid for Nomi in the 12 months before the claim.
      </p>

      <h2 id="dpa">Data processing agreement</h2>
      <p>
        This agreement applies when Nomi processes personal data of the merchant’s customers (“customer data”) for
        the merchant. The merchant is the controller and Nomi is the processor.
      </p>
      <h3>1. Scope and instructions</h3>
      <p>
        Nomi processes customer data only to provide Nomi to the merchant, as described in the{" "}
        <a href="/privacy">privacy policy</a> (subject matter, types of data, categories of people, and duration),
        and on the merchant’s documented instructions, which are these terms and the merchant’s settings in the
        app. Nomi tells the merchant if it believes an instruction breaks data protection law.
      </p>
      <h3>2. Confidentiality and security</h3>
      <p>
        Anyone who can access customer data is bound to confidentiality. Nomi keeps technical and organisational
        measures appropriate to the risk, including encryption in transit and at rest, restricted and logged
        access, verified webhooks, backups, and a written incident response plan.
      </p>
      <h3>3. Sub-processors</h3>
      <p>
        The merchant authorises the sub-processors listed in the privacy policy. Nomi binds each to data protection
        terms at least as protective as these, stays responsible for them, and will update the list before adding
        or replacing one, so the merchant can object.
      </p>
      <h3>4. Helping the merchant</h3>
      <p>
        Nomi helps the merchant answer requests from their customers (access, deletion and similar) and acts on
        Shopify’s customer data and deletion requests. Nomi also gives reasonable help with security, breach
        notifications and data protection impact assessments.
      </p>
      <h3>5. Personal data breaches</h3>
      <p>
        Nomi tells the merchant without undue delay, and within 72 hours of confirming a breach affecting their
        customer data, with the information the merchant needs to meet its own obligations.
      </p>
      <h3>6. Deletion</h3>
      <p>
        When the merchant uninstalls Nomi, Nomi deletes customer data as the privacy policy describes, unless the
        law requires keeping it. Customer email records are deleted 180 days after creation in any case.
      </p>
      <h3>7. Audits and transfers</h3>
      <p>
        Nomi makes available the information needed to show compliance with this agreement and answers reasonable
        written audit questions. Where customer data is transferred out of the EEA, UK or Switzerland, Nomi relies
        on standard contractual clauses or another lawful safeguard.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms or this agreement: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
      </p>
    </LegalPage>
  );
}
