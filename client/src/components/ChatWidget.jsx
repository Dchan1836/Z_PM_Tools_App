import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { sendChat, setDraft, setExpanded } from "../store/chatSlice.js";

export default function ChatWidget() {
  const dispatch = useDispatch();
  const chat = useSelector((state) => state.chat);
  const logRef = useRef(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat.messages, chat.status, chat.expanded]);

  function submit(event) {
    event.preventDefault();
    const text = chat.draft.trim();
    if (!text || chat.status === "sending") return;
    dispatch(setDraft(""));
    dispatch(sendChat(text));
  }

  if (!chat.expanded) {
    return (
      <button type="button" className="chat-launch" onClick={() => dispatch(setExpanded(true))}>
        Ask about the project
      </button>
    );
  }

  return (
    <section className="chat-panel" aria-label="Project assistant">
      <header>
        <div>
          <strong>Project assistant</strong>
          <p>Ask about the project, paste notes to create a meeting, or describe a workflow to create.</p>
        </div>
        <button type="button" className="btn small ghost" onClick={() => dispatch(setExpanded(false))}>Minimize</button>
      </header>
      <div className="chat-log" ref={logRef}>
        {chat.messages.length === 0 ? <p className="muted">Ask who owns a task, what a meeting decided, paste notes to create a meeting, or describe a workflow and its tasks.</p> : null}
        {chat.messages.map((message) => (
          <article key={message.id} className={`chat-bubble ${message.role}`}>
            <p>{message.content}</p>
            {message.sources?.length ? (
              <div className="chat-sources">
                {message.sources.map((source) => <span key={source.id}>{source.kind}: {source.title}</span>)}
              </div>
            ) : null}
          </article>
        ))}
        {chat.status === "sending" ? <p className="muted">Reading your message…</p> : null}
        {chat.error ? <p className="chat-error">{chat.error}</p> : null}
      </div>
      <form onSubmit={submit}>
        <textarea
          value={chat.draft}
          placeholder="Ask a question, paste meeting notes, or describe a workflow"
          rows={2}
          onChange={(event) => dispatch(setDraft(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="btn navy" type="submit" disabled={chat.status === "sending" || !chat.draft.trim()}>Send</button>
      </form>
    </section>
  );
}
