// Campaigns list — mirrors the Flow Editor's page shell (same header, same
// dark-pill button) so the two pages read as one product. Fully static: the
// one-prompt newsletter feature (SPEC.md) generates a campaign preview, but
// audience selection and send delivery are separate launch work, so this
// page shows the gated, pre-launch state — no loader, no real campaign data.

const CAMPAIGNS = [
  {
    name: "best_seller - 08/19/2026",
    date: "—",
    sent: "0",
    open: "0% (0)",
    click: "0% (0)",
    orders: "0",
    revenue: "$0.00",
    status: "Draft",
  },
];

export default function CampaignsPage() {
  return (
    <main className="nomi-flow-page nomi-campaigns-page">
      <div className="nomi-flow-shell">
        <header className="nomi-flow-header">
          <div className="nomi-flow-title">
            <span className="nomi-flow-reference-arrow" aria-hidden="true">←</span>
            <h1>Campaigns</h1>
          </div>
          <div className="nomi-flow-header-actions">
            <button type="button" className="nomi-flow-primary nomi-campaigns-create">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M10 4 V16 M4 10 H16" />
              </svg>
              Create Campaign
            </button>
          </div>
        </header>

        <section className="nomi-campaigns-upsell" aria-label="Upgrade to send campaigns">
          <div className="nomi-campaigns-upsell-title">
            <span aria-hidden="true">!</span>
            <strong>Become a Pro user to start sending campaigns</strong>
          </div>
          <div className="nomi-campaigns-upsell-body">
            <p>Campaigns are only available on the Pro AI plan. Become a Pro and start sending emails.</p>
            <button type="button" className="nomi-campaigns-upgrade">Upgrade to Pro AI</button>
          </div>
        </section>

        <section className="nomi-campaigns-card" aria-label="Campaign list">
          <div className="nomi-campaigns-card-head">
            <span>Campaigns</span>
            <div className="nomi-campaigns-card-actions">
              <button type="button" className="nomi-campaigns-icon-btn" aria-label="Search campaigns">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <circle cx="8.5" cy="8.5" r="5.5" />
                  <path d="M13 13 L17 17" strokeLinecap="round" />
                </svg>
              </button>
              <button type="button" className="nomi-campaigns-icon-btn" aria-label="Toggle list view">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 6 H17 M3 10 H17 M3 14 H17" />
                  <circle cx="7" cy="6" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="13" cy="10" r="1.6" fill="currentColor" stroke="none" />
                  <circle cx="9" cy="14" r="1.6" fill="currentColor" stroke="none" />
                </svg>
              </button>
            </div>
          </div>

          <table className="nomi-campaigns-table">
            <colgroup>
              <col style={{ width: "19%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Date</th>
                <th>Emails sent</th>
                <th>Open Rate</th>
                <th>Click Rate</th>
                <th>Placed Order</th>
                <th>Revenue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {CAMPAIGNS.map((campaign) => (
                <tr key={campaign.name}>
                  <td>
                    <button type="button" className="nomi-campaigns-name">{campaign.name}</button>
                  </td>
                  <td className="nomi-campaigns-muted">{campaign.date}</td>
                  <td>{campaign.sent}</td>
                  <td>{campaign.open}</td>
                  <td>{campaign.click}</td>
                  <td>{campaign.orders}</td>
                  <td>{campaign.revenue}</td>
                  <td>
                    <span className="nomi-campaigns-status">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="4" />
                        <path d="M9 15 L9.6 12.3 L15 7 L17 9 L11.6 14.3 Z" />
                      </svg>
                      {campaign.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="nomi-campaigns-pagination">
            <button type="button" className="nomi-campaigns-page-btn" aria-label="Previous page" disabled>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 4 L5 10 L11 16" />
              </svg>
            </button>
            <button type="button" className="nomi-campaigns-page-btn" aria-label="Next page" disabled>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 4 L15 10 L9 16" />
              </svg>
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
