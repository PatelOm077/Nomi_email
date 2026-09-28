import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  supportGuides,
  type SupportConversation,
  type SupportResult,
} from "./guides";

function Icon({
  name,
}: {
  name: "close" | "arrow" | "chat" | "search" | "back" | "book";
}) {
  const paths = {
    close: "m6 6 12 12M18 6 6 18",
    arrow: "M12 19V5m-6 6 6-6 6 6",
    chat: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 9h10M7 13h6",
    search: "m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    back: "M19 12H5m6-6-6 6 6 6",
    book: "M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const SEEN_KEY = "nomi-support-seen-reply";

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"messages" | "guides">("messages");
  const [conversation, setConversation] = useState<SupportConversation | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [email, setEmail] = useState("");
  const [contact, setContact] = useState(false);
  const [search, setSearch] = useState("");
  const [article, setArticle] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState("");
  const [seenReply, setSeenReply] = useState<string | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const composing = useRef(false);
  const requestVersion = useRef(0);
  const nearBottom = useRef(true);
  const retry = useRef<{ key: string; id: string } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (busy.current) return;
    const version = requestVersion.current;
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const response = await fetch("/api/support", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as SupportResult;
      if (!busy.current && version === requestVersion.current) {
        setConversation((previous) =>
          JSON.stringify(previous) === JSON.stringify(result.conversation)
            ? previous
            : result.conversation,
        );
        setLoaded(true);
      }
    } catch {
      if (!quiet) setError("Your conversation couldn’t load. Try again.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [open, load]);
  // Closed, Nomi still checks for a team reply so the launcher can show it.
  useEffect(() => {
    if (open) return;
    void load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [open, load]);
  const latestReply = conversation?.messages
    .filter((message) => message.role === "agent")
    .at(-1)?.id;
  useEffect(() => {
    try {
      setSeenReply(window.localStorage.getItem(SEEN_KEY));
    } catch {
      // Storage can be blocked in the admin iframe; the dot just won't persist.
    }
  }, []);
  useEffect(() => {
    if (!open || !latestReply || tab !== "messages") return;
    setSeenReply(latestReply);
    try {
      window.localStorage.setItem(SEEN_KEY, latestReply);
    } catch {
      // See above.
    }
  }, [open, latestReply, tab]);
  const unread = Boolean(latestReply && latestReply !== seenReply);
  useEffect(() => {
    // Empty, the welcome reads from its heading; only a thread pins to the end.
    if (!conversation?.messages.length && !optimistic) return;
    if (open && tab === "messages" && nearBottom.current)
      messages.current?.scrollTo({ top: messages.current.scrollHeight });
  }, [conversation, open, tab, optimistic]);
  useEffect(() => {
    if (contact) emailInput.current?.focus();
  }, [contact]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);

  const close = () => {
    setOpen(false);
    launcher.current?.focus();
  };
  const askTeam = () => {
    setTab("messages");
    setEmail(conversation?.email ?? "");
    setContact(true);
  };
  async function send(intent: "message" | "request-help", text: string) {
    if (busy.current || !loaded) return;
    busy.current = true;
    requestVersion.current++;
    setSending(true);
    setError("");
    nearBottom.current = true;
    if (intent === "message") setOptimistic(text);
    const key = `${intent}:${text}`;
    if (retry.current?.key !== key)
      retry.current = { key, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        // Long enough for the AI answer; a timed-out retry reuses the requestId.
        signal: AbortSignal.timeout(75000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          intent,
          requestId: retry.current.id,
          ...(intent === "message" ? { body: text } : { email: text }),
        }),
      });
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new Error(
          "Reconnect to Nomi, then try again. Your draft is still here.",
        );
      const result = (await response.json()) as SupportResult;
      if (!response.ok || result.error)
        throw new Error(
          result.error || "Your message wasn’t saved. Try again.",
        );
      setConversation(result.conversation);
      retry.current = null;
      if (intent === "message") setDraft("");
      else setContact(false);
      requestAnimationFrame(() => composer.current?.focus());
    } catch (cause) {
      setError(
        cause instanceof Error &&
          cause.name !== "TimeoutError" &&
          cause.name !== "TypeError"
          ? cause.message
          : "Couldn’t connect. Your draft is safe. Try sending again.",
      );
    } finally {
      busy.current = false;
      setSending(false);
      setOptimistic("");
    }
  }
  const guide = supportGuides.find((item) => item.id === article);
  const filtered = supportGuides.filter((item) =>
    `${item.title} ${item.category} ${item.keywords}`
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  const hasMessages = Boolean(conversation?.messages.length || optimistic);
  const waiting =
    conversation?.status === "waiting" || conversation?.status === "replied";

  return (
    <div className="nomi-support">
      {open && (
        <section
          id="nomi-support-panel"
          className="nomi-support-panel"
          role="dialog"
          aria-label="Nomi help"
        >
          <header className="nomi-support-header">
            <div className="nomi-support-lockup">
              <img src="/nomi-mark.svg" alt="" width="32" height="32" />
              <span>Nomi</span>
              <span className="nomi-support-help-label">Here to help</span>
            </div>
            <button
              ref={closeButton}
              className="nomi-support-icon"
              onClick={close}
              aria-label="Close support"
            >
              <Icon name="close" />
            </button>
          </header>
          <nav className="nomi-support-tabs" aria-label="Support sections">
            <button
              aria-pressed={tab === "messages"}
              onClick={() => {
                setTab("messages");
                nearBottom.current = true;
              }}
            >
              <Icon name="chat" />
              Messages
            </button>
            <button
              aria-pressed={tab === "guides"}
              onClick={() => setTab("guides")}
            >
              <Icon name="book" />
              Help library
            </button>
          </nav>
          {tab === "messages" ? (
            <>
              <div
                className="nomi-support-messages"
                ref={messages}
                onScroll={() => {
                  const el = messages.current;
                  if (el)
                    nearBottom.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 70;
                }}
              >
                {!hasMessages && (
                  <div className="nomi-support-welcome">
                    <span className="nomi-support-eyebrow">A note away</span>
                    <h2>
                      A little clarity.
                      <br />
                      Then, back to it.
                    </h2>
                    <p>
                      Find an answer, work through a question,
                      <br className="nomi-support-desktop-break" /> or leave a
                      note for our team.
                    </p>
                    <div className="nomi-support-prompts">
                      <span className="nomi-support-eyebrow">
                        Start with a question
                      </span>
                      {[
                        {
                          title: "Get my store ready",
                          prompt: "How do I set up Nomi?",
                        },
                        {
                          title: "Find out why an email hasn’t sent",
                          prompt: "Why hasn’t an email sent?",
                        },
                        {
                          title: "Make my emails feel on-brand",
                          prompt: "How do I change my brand design?",
                        },
                      ].map((item) => (
                        <button
                          key={item.prompt}
                          disabled={sending || !loaded}
                          onClick={() => void send("message", item.prompt)}
                        >
                          {item.title}
                          <span aria-hidden="true">↗</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {loading && !loaded && (
                  <p role="status" className="nomi-support-note">
                    Connecting to your conversation…
                  </p>
                )}
                <div
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions"
                  aria-label="Conversation"
                >
                  {hasMessages && (
                    <p className="nomi-support-conversation-label">
                      Your conversation with Nomi
                    </p>
                  )}
                  {conversation?.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`nomi-support-message nomi-support-message--${message.role}`}
                    >
                      <div className="nomi-support-author">
                        <span>
                          {message.role === "merchant"
                            ? "You"
                            : message.role === "agent"
                              ? "Nomi team"
                              : message.role === "system"
                                ? "Update"
                                : "Nomi assistant · AI"}
                        </span>
                        <time dateTime={message.createdAt}>
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <p>{message.body}</p>
                    </div>
                  ))}
                  {optimistic && (
                    <div className="nomi-support-message nomi-support-message--merchant nomi-support-pending">
                      <div className="nomi-support-author">
                        You <span>Sending</span>
                      </div>
                      <p>{optimistic}</p>
                    </div>
                  )}
                  {sending && (
                    <div
                      role="status"
                      aria-label={
                        waiting ? "Saving message" : "Nomi is writing an answer"
                      }
                      className="nomi-support-typing"
                    >
                      <i />
                      <i />
                      <i />
                    </div>
                  )}
                </div>
              </div>
              <div className="nomi-support-bottom">
                {error && (
                  <div className="nomi-support-error" role="alert">
                    {error}
                    {!loaded && (
                      <button onClick={() => void load()}>Try again</button>
                    )}
                  </div>
                )}
                {contact ? (
                  <form
                    className="nomi-support-contact"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send("request-help", email.trim());
                    }}
                  >
                    <div className="nomi-support-contact-title">
                      <h3>Let’s bring in the team.</h3>
                      <button
                        type="button"
                        className="nomi-support-icon"
                        onClick={() => setContact(false)}
                        aria-label="Cancel support request"
                        disabled={sending}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                    <p>
                      We’ll share this conversation, so you won’t need to
                      explain it twice. The reply appears here, and we’ll
                      email you when it does.
                    </p>
                    <label htmlFor="nomi-support-email">Your email</label>
                    <input
                      ref={emailInput}
                      id="nomi-support-email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(event) => setEmail(event.currentTarget.value)}
                      placeholder="you@yourstore.com"
                      disabled={sending}
                    />
                    <button
                      className="nomi-support-primary nomi-support-request"
                      type="submit"
                      disabled={sending || !loaded}
                    >
                      {sending ? "Saving request…" : "Send to the team"}
                      <span aria-hidden="true">↗</span>
                    </button>
                  </form>
                ) : (
                  <>
                    <form
                      className="nomi-support-compose"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (draft.trim()) void send("message", draft.trim());
                      }}
                    >
                      <label
                        className="nomi-support-sr"
                        htmlFor="nomi-support-draft"
                      >
                        Your message
                      </label>
                      <textarea
                        ref={composer}
                        onCompositionStart={() => {
                          composing.current = true;
                        }}
                        onCompositionEnd={() => {
                          composing.current = false;
                        }}
                        id="nomi-support-draft"
                        placeholder={
                          waiting
                            ? "Add a note for the team…"
                            : "What can we help you with?"
                        }
                        maxLength={2000}
                        rows={2}
                        value={draft}
                        readOnly={sending}
                        onChange={(event) =>
                          setDraft(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !composing.current
                          ) {
                            event.preventDefault();
                            if (draft.trim())
                              void send("message", draft.trim());
                          }
                        }}
                      />
                      <div>
                        <span>
                          {draft.length
                            ? `${draft.length.toLocaleString()}/2,000`
                            : "Enter to send · Shift + Enter for a new line"}
                        </span>
                        <button
                          type="submit"
                          className="nomi-support-primary"
                          aria-label="Send message"
                          disabled={!draft.trim() || sending || !loaded}
                        >
                          <Icon name="arrow" />
                        </button>
                      </div>
                    </form>
                    <div className="nomi-support-handoff">
                      <span>
                        {waiting
                          ? "With the Nomi team"
                          : conversation?.status === "resolved"
                            ? "Resolved · write to reopen"
                            : "Prefer a human?"}
                      </span>
                      <button onClick={askTeam} disabled={sending || !loaded}>
                        {conversation?.email
                          ? "Contact details"
                          : "Talk to the team"}
                        <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                  </>
                )}
                <p className="nomi-support-footnote">
                  {waiting
                    ? "Replies appear here. Your conversation is saved."
                    : "AI answers from Nomi’s guides and your store. A person when you need one."}
                </p>
              </div>
            </>
          ) : (
            <div className="nomi-support-guides" key={article ?? "library"}>
              {guide ? (
                <article>
                  <button
                    className="nomi-support-back"
                    onClick={() => setArticle(null)}
                  >
                    <Icon name="back" /> Help library
                  </button>
                  <span className="nomi-support-eyebrow">{guide.category}</span>
                  <h2>{guide.title}</h2>
                  <p>{guide.body}</p>
                  {"href" in guide && (
                    <Link
                      className="nomi-support-guide-link"
                      to={guide.href}
                      onClick={close}
                    >
                      {guide.action} <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                  <div className="nomi-support-article-help">
                    <span>Still need a hand?</span>
                    <button onClick={askTeam}>
                      Talk to the team <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </article>
              ) : (
                <>
                  <div className="nomi-support-library-intro">
                    <span className="nomi-support-eyebrow">
                      The help library
                    </span>
                    <h2>
                      Less searching.
                      <br />
                      More doing.
                    </h2>
                  </div>
                  <div className="nomi-support-search">
                    <Icon name="search" />
                    <label
                      className="nomi-support-sr"
                      htmlFor="nomi-support-search"
                    >
                      Search guides
                    </label>
                    <input
                      id="nomi-support-search"
                      type="search"
                      placeholder="Find an answer…"
                      value={search}
                      onChange={(event) => setSearch(event.currentTarget.value)}
                    />
                  </div>
                  <div className="nomi-support-guide-list">
                    {filtered.map((item) => (
                      <button key={item.id} onClick={() => setArticle(item.id)}>
                        <span>
                          <small>{item.category}</small>
                          {item.title}
                        </span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                  {!filtered.length && (
                    <div className="nomi-support-empty" role="status">
                      <h3>No matching guides.</h3>
                      <p>Try a different word, or let the team help.</p>
                      <button onClick={askTeam}>Talk to the team ↗</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
      <button
        ref={launcher}
        className={`nomi-support-launcher${open ? " is-open" : ""}`}
        aria-label={
          open
            ? "Close Nomi help"
            : unread
              ? "Open Nomi help, the team replied"
              : "Open Nomi help"
        }
        aria-expanded={open}
        aria-controls="nomi-support-panel"
        onClick={() => {
          if (open) return close();
          setOpen(true);
          if (unread) setTab("messages");
        }}
      >
        <Icon name={open ? "close" : "chat"} />
        <span>{open ? "Close" : "Nomi help"}</span>
        {unread && !open && (
          <i className="nomi-support-unread" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
