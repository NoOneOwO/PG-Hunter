import * as React from "react";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Mic,
  Paperclip,
  Search,
  Send,
  Square,
  Video as VideoIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CHAT_MIME_TYPES,
  MAX_AUDIO_MS,
  enquiryReplyLabel,
  formatBytes,
  validateChatAttachment,
} from "@/lib/chatRules";
import {
  getConversations,
  getThread,
  markThreadRead,
  sendAttachment,
  sendTextMessage,
  startConversation,
  type ChatConversation,
  type ChatMessage,
  type ChatThread,
} from "@/lib/chat";

/** How often an open thread is polled. Chat is not worth a websocket (yet). */
const POLL_MS = 4000;

export interface ChatStarter {
  /** What the row reads as, e.g. the PG name or the student's name. */
  title: string;
  subtitle?: string;
  ownerId?: string;
  studentId?: string;
  listingId?: string;
}

interface Props {
  /** Which side of every conversation this viewer is on. */
  role: "student" | "owner";
  /** Someone to message, deep-linked from a listing page or an enquiry row. */
  startOwnerId?: string;
  startStudentId?: string;
  startListingId?: string;
  /** The enquiry being answered — tags the thread so the student's inbox can say so. */
  startEnquiryLeadId?: number;
  /** People this viewer can start a new conversation with. */
  starters: ChatStarter[];
}

const initialsOf = (name: string): string =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

const timeLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};

const dayLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
};

const clockLabel = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** The avatar chip used in both the list and the thread header. */
const Avatar = ({
  name,
  src,
  size = "md",
}: {
  name: string;
  src: string | null;
  size?: "md" | "sm";
}) => {
  const [failed, setFailed] = React.useState(false);
  const box = size === "md" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs";
  const showImage = src && !failed;
  return (
    <span
      className={`relative flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-sm bg-brand-600 font-extrabold text-white`}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initialsOf(name)}</span>
      )}
    </span>
  );
};

/** One attachment, rendered by kind. */
const AttachmentView = ({ message }: { message: ChatMessage }) => {
  const attachment = message.attachment;
  if (!attachment) return null;

  if (message.kind === "image") {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block max-w-xs overflow-hidden rounded-sm border border-slate-200 bg-white"
      >
        <img
          src={attachment.url}
          alt={attachment.name}
          loading="lazy"
          className="max-h-72 w-full object-cover"
        />
      </a>
    );
  }

  if (message.kind === "video") {
    return (
      <video
        src={attachment.url}
        controls
        preload="metadata"
        className="mt-1 max-h-80 w-full max-w-sm rounded-sm border border-slate-200 bg-black"
      />
    );
  }

  if (message.kind === "audio") {
    return (
      <span className="mt-1 flex flex-col gap-1">
        <audio src={attachment.url} controls preload="metadata" className="h-9 max-w-full" />
        {attachment.durationMs ? (
          <span className="text-[11px] font-medium opacity-70">
            Voice note · {clockLabel(attachment.durationMs / 1000)}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex items-center gap-2 rounded-sm border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:border-brand-300"
    >
      <FileText className="h-5 w-5 shrink-0 text-brand-600" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{attachment.name}</span>
        <span className="block text-[11px] text-slate-500">{formatBytes(attachment.size)}</span>
      </span>
      <ExternalLink className="ml-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
    </a>
  );
};

export default function ChatApp({
  role,
  startOwnerId,
  startStudentId,
  startListingId,
  startEnquiryLeadId,
  starters,
}: Props) {
  const [conversations, setConversations] = React.useState<ChatConversation[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<ChatThread | null>(null);
  const [loadingThread, setLoadingThread] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [showStarters, setShowStarters] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [recordedMs, setRecordedMs] = React.useState(0);

  const scroller = React.useRef<HTMLDivElement | null>(null);
  const lastSeq = React.useRef(0);
  const pollRef = React.useRef<number | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const startedAtRef = React.useRef(0);
  const autoStartedRef = React.useRef(false);
  const inputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});

  const refreshList = React.useCallback(async () => {
    try {
      const { conversations: rows } = await getConversations();
      setConversations(rows);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const scrollToBottom = React.useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const openConversation = React.useCallback(
    async (id: string) => {
      setActiveId(id);
      setLoadingThread(true);
      setError(null);
      try {
        const data = await getThread(id);
        setThread(data);
        setMessages(data.messages);
        lastSeq.current = data.messages.reduce((max, m) => Math.max(max, m.seq), 0);
        // Support viewers (admins who are not participants) may read but not
        // reply, so their visit never marks the thread read.
        if (data.conversation.canWrite) {
          await markThreadRead(id).catch(() => undefined);
        }
        await refreshList();
        requestAnimationFrame(() => scrollToBottom());
      } catch (err) {
        setError((err as Error).message);
        setThread(null);
        setMessages([]);
      } finally {
        setLoadingThread(false);
      }
    },
    [refreshList, scrollToBottom]
  );

  /* ---- initial load, plus a deep-linked conversation ---------------- */
  React.useEffect(() => {
    void refreshList();
  }, [refreshList]);

  React.useEffect(() => {
    if (autoStartedRef.current) return;
    const wantsStart = startOwnerId || startStudentId;
    if (!wantsStart) return;
    autoStartedRef.current = true;

    void (async () => {
      try {
        const { conversationId } = await startConversation({
          ownerId: startOwnerId,
          studentId: startStudentId,
          listingId: startListingId,
          enquiryLeadId: startEnquiryLeadId,
        });
        await openConversation(conversationId);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [openConversation, startEnquiryLeadId, startListingId, startOwnerId, startStudentId]);

  /* ---- polling ------------------------------------------------------ */
  React.useEffect(() => {
    if (!activeId) return;
    if (pollRef.current) window.clearInterval(pollRef.current);

    pollRef.current = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const data = await getThread(activeId, lastSeq.current);
        if (data.messages.length > 0) {
          lastSeq.current = data.messages.reduce(
            (max, m) => Math.max(max, m.seq),
            lastSeq.current
          );
          setMessages((prev) => [...prev, ...data.messages]);
          setThread(data);
          if (data.conversation.canWrite) {
            await markThreadRead(activeId).catch(() => undefined);
          }
          requestAnimationFrame(() => scrollToBottom(true));
        }
        void refreshList();
      } catch {
        // A dropped poll is not worth a banner; the next tick will retry.
      }
    }, POLL_MS);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [activeId, refreshList, scrollToBottom]);

  /* ---- sending ------------------------------------------------------ */
  const sendText = async () => {
    const body = draft.trim();
    if (!body || !activeId) return;
    setError(null);
    setBusy("text");
    try {
      const { message } = await sendTextMessage(activeId, body);
      setMessages((prev) => [...prev, message]);
      lastSeq.current = Math.max(lastSeq.current, message.seq);
      setDraft("");
      void refreshList();
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const uploadFile = async (file: File, durationMs?: number) => {
    if (!activeId) return;
    const check = validateChatAttachment(file.type, file.size);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    setBusy(check.kind);
    try {
      const { message } = await sendAttachment(activeId, file, { durationMs });
      setMessages((prev) => [...prev, message]);
      lastSeq.current = Math.max(lastSeq.current, message.seq);
      void refreshList();
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pickFile = (kind: keyof typeof CHAT_MIME_TYPES) => {
    const input = inputRefs.current[kind];
    input?.click();
  };

  /* ---- voice notes -------------------------------------------------- */
  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ["audio/webm", "audio/mp4", "audio/ogg"].find(
        (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)
      );
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setRecordedMs(0);
      setRecording(true);
      recorder.start();
    } catch {
      setError("Microphone access was blocked, so a voice note cannot be recorded.");
    }
  };

  const stopRecording = (send: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const elapsed = Date.now() - startedAtRef.current;

    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((track) => track.stop());
      if (!send) return;
      const type = recorder.mimeType.split(";")[0] || "audio/webm";
      const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size === 0) return;
      const file = new File([blob], `voice-note.${extension}`, { type });
      void uploadFile(file, elapsed);
    };

    recorder.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  React.useEffect(() => {
    if (!recording) return;
    const tick = window.setInterval(() => setRecordedMs(Date.now() - startedAtRef.current), 250);
    const cap = window.setTimeout(() => stopRecording(true), MAX_AUDIO_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(cap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  /* ---- derived ------------------------------------------------------ */
  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) =>
      [c.counterpart.name, c.listingName ?? ""].some((field) =>
        field.toLowerCase().includes(term)
      )
    );
  }, [conversations, search]);

  const openStarter = async (starter: ChatStarter) => {
    setError(null);
    try {
      const { conversationId } = await startConversation({
        ownerId: starter.ownerId,
        studentId: starter.studentId,
        listingId: starter.listingId,
      });
      setShowStarters(false);
      await openConversation(conversationId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const counterpartLabel = thread
    ? role === "owner"
      ? thread.conversation.participants.student
      : thread.conversation.participants.owner
    : null;

  let lastDay = "";
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      {/* ------------------------------------------------ conversation list */}
      <section
        className={`card flex max-h-[70vh] min-h-[28rem] flex-col overflow-hidden p-0 ${
          activeId ? "hidden lg:flex" : "flex"
        }`}
        aria-label="Conversations"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <MessageSquare className="h-4 w-4 text-brand-600" />
            Conversations
            {totalUnread > 0 && (
              <span className="badge bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">
                {totalUnread}
              </span>
            )}
          </h2>
          {starters.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => setShowStarters((open) => !open)}
            >
              {showStarters ? <X className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              {showStarters ? "Close" : "New"}
            </Button>
          )}
        </div>

        {showStarters && (
          <div className="max-h-56 overflow-y-auto border-b border-slate-100 bg-slate-50 px-3 py-3">
            <p className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              {role === "student" ? "Message an owner about" : "Message a student about"}
            </p>
            <ul className="flex flex-col gap-1">
              {starters.map((starter) => (
                <li key={`${starter.title}-${starter.listingId ?? starter.subtitle ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => openStarter(starter)}
                    className="flex w-full items-center gap-2 rounded-sm border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-brand-300"
                  >
                    <Building2 className="h-4 w-4 shrink-0 text-brand-600" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-800">
                        {starter.title}
                      </span>
                      {starter.subtitle && (
                        <span className="block truncate text-[11px] text-slate-500">
                          {starter.subtitle}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="field mx-4 mt-3 mb-2 !min-h-9">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="sr-only">Search conversations</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or PG"
            className="w-full bg-transparent text-xs outline-none"
          />
        </label>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="flex flex-col gap-3 p-4">
              {[0, 1, 2].map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-sm" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-xs text-slate-500">
              {conversations.length === 0
                ? role === "student"
                  ? "No conversations yet. Open a PG and tap “Message owner”, or start one from “New”."
                  : "No conversations yet. Enquiries from students appear here once you reply."
                : "Nothing matches that search."}
            </p>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => void openConversation(conversation.id)}
                    className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-brand-50/60 ${
                      activeId === conversation.id ? "bg-brand-50/80" : ""
                    }`}
                  >
                    <Avatar name={conversation.counterpart.name} src={conversation.counterpart.avatar} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-slate-900">
                          {conversation.counterpart.name}
                        </span>
                        {conversation.unread > 0 && (
                          <span className="ml-auto shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {conversation.unread}
                          </span>
                        )}
                      </span>
                      {conversation.enquiryReply && role === "student" ? (
                        <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-semibold text-emerald-700">
                          <Building2 className="h-3 w-3 shrink-0" />
                          {enquiryReplyLabel(conversation.listingName)}
                        </span>
                      ) : conversation.listingName ? (
                        <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-semibold text-brand-700">
                          <Building2 className="h-3 w-3" /> {conversation.listingName}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {conversation.lastMessage
                          ? `${conversation.lastMessage.fromMe ? "You: " : ""}${conversation.lastMessage.preview}`
                          : "Say hello"}
                      </span>
                    </span>
                    <span className="shrink-0 self-start text-[10px] font-medium text-slate-400">
                      {timeLabel(conversation.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* --------------------------------------------------------- thread */}
      <section
        className={`card flex max-h-[70vh] min-h-[28rem] flex-col overflow-hidden p-0 ${
          activeId ? "flex" : "hidden lg:flex"
        }`}
        aria-label="Conversation"
      >
        {!activeId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageSquare className="h-7 w-7 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">Pick a conversation</p>
            <p className="max-w-xs text-xs text-slate-500">
              Messages, photos, videos, documents and voice notes stay between you and the other person.
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setActiveId(null);
                  setThread(null);
                  setMessages([]);
                  void refreshList();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-sm text-slate-500 hover:bg-slate-100 lg:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              {counterpartLabel && (
                <Avatar name={counterpartLabel.name} src={counterpartLabel.avatar} size="sm" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900">
                  {counterpartLabel?.name ?? "Conversation"}
                </p>
                {thread?.conversation.enquiryReply && role === "student" ? (
                  <p className="flex items-center gap-1 truncate text-[11px] font-semibold text-emerald-700">
                    <Building2 className="h-3 w-3 shrink-0" />
                    {enquiryReplyLabel(thread.conversation.listingName)}
                  </p>
                ) : thread?.conversation.listingName ? (
                  <p className="flex items-center gap-1 truncate text-[11px] font-semibold text-brand-700">
                    <Building2 className="h-3 w-3" /> {thread.conversation.listingName}
                  </p>
                ) : null}
              </div>
              {thread?.conversation.listingId && (
                <a
                  href={`/pgs/live/${encodeURIComponent(thread.conversation.listingId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  View PG <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </header>

            <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {loadingThread ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((n) => (
                    <Skeleton key={n} className="h-12 w-2/3 rounded-sm" />
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <p className="py-12 text-center text-xs text-slate-500">
                  No messages yet — say hello and introduce yourself.
                </p>
              ) : (
                messages.map((message) => {
                  const day = dayLabel(message.createdAt);
                  const showDay = day !== lastDay;
                  lastDay = day;
                  return (
                    <React.Fragment key={message.id}>
                      {showDay && (
                        <p className="py-1 text-center text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                          {day}
                        </p>
                      )}
                      <div
                        className={`flex flex-col ${message.fromMe ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-sm px-3.5 py-2.5 text-sm shadow-sm ${
                            message.fromMe
                              ? "bg-brand-600 text-white"
                              : "border border-slate-200 bg-white text-slate-800"
                          }`}
                        >
                          {message.body && (
                            <p className="break-words whitespace-pre-wrap">{message.body}</p>
                          )}
                          <AttachmentView message={message} />
                        </div>
                        <span className="mt-1 text-[10px] font-medium text-slate-400">
                          {clockLabel(new Date(message.createdAt).getTime() / 1000) === "0:00"
                            ? timeLabel(message.createdAt)
                            : timeLabel(message.createdAt)}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
            </div>

            {error && (
              <p className="mx-4 mb-2 rounded-sm bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
                {error}
              </p>
            )}

            {thread && !thread.conversation.canWrite ? (
              <p className="border-t border-slate-100 px-4 py-3 text-xs font-medium text-slate-500">
                Support view — you can read this conversation but only the student and the owner can reply.
              </p>
            ) : (
              <div className="border-t border-slate-100 px-3 py-3">
                {recording && (
                  <p className="mb-2 flex items-center gap-2 rounded-sm bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                    Recording {clockLabel(recordedMs / 1000)} — tap stop to send
                  </p>
                )}

                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Send a photo"
                      aria-label="Send a photo"
                      disabled={Boolean(busy)}
                      onClick={() => pickFile("image")}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Send a video"
                      aria-label="Send a video"
                      disabled={Boolean(busy)}
                      onClick={() => pickFile("video")}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
                    >
                      <VideoIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Send a document"
                      aria-label="Send a document"
                      disabled={Boolean(busy)}
                      onClick={() => pickFile("document")}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title={recording ? "Stop recording" : "Record a voice note"}
                      aria-label={recording ? "Stop recording" : "Record a voice note"}
                      disabled={Boolean(busy)}
                      onClick={() => (recording ? stopRecording(true) : void startRecording())}
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-sm transition-colors disabled:opacity-40 ${
                        recording
                          ? "bg-rose-50 text-rose-600"
                          : "text-slate-500 hover:bg-slate-100"
                      }`}
                    >
                      {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </button>
                  </div>

                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendText();
                      }
                    }}
                    rows={1}
                    maxLength={2000}
                    placeholder="Write a message…"
                    className="min-h-10 flex-1 resize-none py-2.5 text-sm"
                  />

                  <Button
                    type="button"
                    onClick={() => void sendText()}
                    disabled={Boolean(busy) || draft.trim().length === 0}
                    className="h-10 gap-1.5 px-4"
                  >
                    {busy === "text" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </Button>
                </div>

                {busy && busy !== "text" && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Uploading {busy}…
                  </p>
                )}

                {/* Hidden pickers. The accept lists mirror the server allowlist
                    in lib/chatRules.ts so an unsupported file is refused before
                    it is uploaded, not after. */}
                {(["image", "video", "document"] as const).map((kind) => (
                  <input
                    key={kind}
                    ref={(el) => {
                      inputRefs.current[kind] = el;
                    }}
                    type="file"
                    accept={CHAT_MIME_TYPES[kind].join(",")}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadFile(file);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
