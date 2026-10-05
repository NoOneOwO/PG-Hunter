import * as React from "react";
import {
  Bookmark,
  Building2,
  Check,
  Copy,
  GraduationCap,
  ImageUp,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Toaster, toast } from "sonner";

import { PixelBanner } from "@/components/profile/PixelBanner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import type { AppUser } from "@/lib/auth";
import {
  getSavedIds,
  getSession,
  initialsOf,
  redirectToLogin,
  removeAvatar,
  signOut,
  toggleSaved,
  updateProfile,
  uploadAvatar,
} from "@/lib/auth";
import { renderSavedGrid } from "@/lib/savedPgs";

export interface CollegeOption {
  slug: string;
  name: string;
  shortName: string;
}

interface Props {
  colleges: CollegeOption[];
}

/** Radix <Select.Item> rejects an empty string, so optional selects use sentinels. */
const NO_COLLEGE = "__none__";
const NO_MONTH = "__none__";
const NO_BUDGET = "__none__";

/** Budget bands shared with the browse filters (/pgs-near-you) and the API. */
const BUDGET_OPTIONS = [
  { value: "under-10", label: "Under ₹10,000" },
  { value: "10-15", label: "₹10,000 – ₹15,000" },
  { value: "15-20", label: "₹15,000 – ₹20,000" },
  { value: "20-plus", label: "₹20,000 and above" },
] as const;

/** The next 8 months, as the enquiry form's move-in picker uses. */
const monthOptions = (): { value: string; label: string }[] => {
  const now = new Date();
  return Array.from({ length: 8 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    };
  });
};

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/** Loosely validated so international formats survive; blank is always fine. */
const phoneProblem = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = digitsOf(trimmed);
  if (digits.length < 7 || digits.length > 15) {
    return "Enter 7–15 digits, e.g. +91 98765 43210.";
  }
  return null;
};

const memberSince = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const fullMemberSince = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

function ProfileApp({ colleges }: Props) {
  const [user, setUser] = React.useState<AppUser | null>(null);
  const [booting, setBooting] = React.useState(true);

  const [form, setForm] = React.useState({
    name: "",
    phone: "",
    college: NO_COLLEGE,
    city: "",
    movingInMonth: NO_MONTH,
    budgetPref: NO_BUDGET,
    availability: "",
    messageToOwners: "",
  });
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [tab, setTab] = React.useState("details");
  const [savedIds, setSavedIds] = React.useState<string[]>([]);
  const [savedLoading, setSavedLoading] = React.useState(false);
  const [signOutOpen, setSignOutOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [avatarBusy, setAvatarBusy] = React.useState(false);
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null);

  const detailsRef = React.useRef<HTMLDivElement>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  const savedGridRef = React.useRef<HTMLDivElement>(null);

  /* --------------------------------------------------- saved ------- */

  // Radix <TabsContent> defers mounting the inactive panel, so at the moment an
  // effect keyed on `tab` runs the grid element does not exist yet (hasGrid:
  // false) and the shortlist renders empty. A callback ref is the only hook
  // that fires when the node is actually attached; its identity depends on
  // savedIds, so it also re-fires whenever the shortlist changes.
  const attachSavedGrid = React.useCallback(
    (node: HTMLDivElement | null) => {
      savedGridRef.current = node;
      if (!node) return;
      if (savedIds.length === 0) {
        node.innerHTML = "";
        return;
      }
      void renderSavedGrid(node, savedIds, { removable: true });
    },
    [savedIds]
  );

  /* -------------------------------------------------- session ------ */

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await getSession();
      if (cancelled) return;
      if (!current) {
        redirectToLogin("/profile");
        return;
      }
      // Owners have a dedicated shell at /owner/profile — keep this one student-only.
      if (current.role === "owner" || current.isAdmin) {
        window.location.replace("/owner/profile");
        return;
      }
      setUser(current);
      setForm({
        name: current.name,
        phone: current.phone ?? "",
        college: current.collegeSlug ?? NO_COLLEGE,
        city: current.city ?? "",
        movingInMonth: current.movingInMonth ?? NO_MONTH,
        budgetPref: current.budgetPref ?? NO_BUDGET,
        availability: current.availability ?? "",
        messageToOwners: current.messageToOwners ?? "",
      });
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      setSavedLoading(true);
      const ids = await getSavedIds();
      if (cancelled) return;
      setSavedIds(ids);
      setSavedLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onSavedGridClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-remove-saved]"
    );
    if (!button) return;
    const removedId = button.dataset.removeSaved ?? "";
    const { error } = await toggleSaved(removedId);
    if (error) {
      toast.error(error);
      return;
    }
    const previous = savedIds;
    setSavedIds(previous.filter((id) => id !== removedId));
    window.dispatchEvent(new CustomEvent("pghunter:saved"));
    toast("Removed from your shortlist", {
      description: "Changed your mind? Put it back in one tap.",
      // An Undo affordance needs long enough to actually reach the button.
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => void undoSave(removedId, previous),
      },
    });
  };

  const undoSave = async (id: string, previous: string[]) => {
    const { error } = await toggleSaved(id);
    if (error) {
      toast.error(error);
      return;
    }
    setSavedIds(previous);
    window.dispatchEvent(new CustomEvent("pghunter:saved"));
    toast.success("Back in your shortlist");
  };

  /* --------------------------------------------------- form -------- */

  const phoneError = phoneProblem(form.phone);
  const nameError = form.name.trim() ? null : "Your name cannot be empty.";

  const dirty = React.useMemo(() => {
    if (!user) return false;
    return (
      form.name !== user.name ||
      form.phone !== (user.phone ?? "") ||
      form.college !== (user.collegeSlug ?? NO_COLLEGE) ||
      form.city !== (user.city ?? "") ||
      form.movingInMonth !== (user.movingInMonth ?? NO_MONTH) ||
      form.budgetPref !== (user.budgetPref ?? NO_BUDGET) ||
      form.availability !== (user.availability ?? "") ||
      form.messageToOwners !== (user.messageToOwners ?? "")
    );
  }, [form, user]);

  const patch = (next: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...next }));
    setFormError(null);
  };

  const resetForm = () => {
    if (!user) return;
    setForm({
      name: user.name,
      phone: user.phone ?? "",
      college: user.collegeSlug ?? NO_COLLEGE,
      city: user.city ?? "",
      movingInMonth: user.movingInMonth ?? NO_MONTH,
      budgetPref: user.budgetPref ?? NO_BUDGET,
      availability: user.availability ?? "",
      messageToOwners: user.messageToOwners ?? "",
    });
    setFormError(null);
  };

  const onSubmit: React.ComponentProps<"form">["onSubmit"] = async (event) => {
    event?.preventDefault();
    if (!user) return;
    if (nameError || phoneError) {
      setFormError("Fix the highlighted fields before saving.");
      return;
    }
    setSaving(true);
    setFormError(null);
    // An emptied field is a deliberate clear, so it is sent as null rather
    // than omitted: `undefined` means "leave this field as it was".
    const orClear = (next: string, current: string | undefined): string | null | undefined =>
      next ? next : current ? null : undefined;

    const { user: updated, error } = await updateProfile({
      name: form.name.trim(),
      phone: form.phone.trim(),
      collegeSlug:
        form.college === NO_COLLEGE
          ? user.collegeSlug
            ? null
            : undefined
          : form.college,
      city: orClear(form.city.trim(), user.city),
      movingInMonth: orClear(
        form.movingInMonth === NO_MONTH ? "" : form.movingInMonth,
        user.movingInMonth
      ),
      budgetPref: orClear(
        form.budgetPref === NO_BUDGET ? "" : form.budgetPref,
        user.budgetPref
      ),
      availability: orClear(form.availability.trim(), user.availability),
      messageToOwners: orClear(form.messageToOwners.trim(), user.messageToOwners),
    });
    setSaving(false);
    if (error || !updated) {
      setFormError(error ?? "Something went wrong. Please try again.");
      toast.error("Could not save your changes");
      return;
    }
    setUser(updated);
    setForm({
      name: updated.name,
      phone: updated.phone ?? "",
      college: updated.collegeSlug ?? NO_COLLEGE,
      city: updated.city ?? "",
      movingInMonth: updated.movingInMonth ?? NO_MONTH,
      budgetPref: updated.budgetPref ?? NO_BUDGET,
      availability: updated.availability ?? "",
      messageToOwners: updated.messageToOwners ?? "",
    });
    toast.success("Profile updated", {
      description: "Your details are saved.",
    });
  };

  const onSignOut = async () => {
    setSigningOut(true);
    await signOut();
    window.location.href = "/";
  };

  const copyEmail = async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.email);
      toast.success("Email copied");
    } catch {
      toast.error("Could not copy — select the address manually.");
    }
  };

  /* --------------------------------------------------- avatar ----- */

  /**
   * "Edit details" has to do something when the Details tab is already open,
   * which is the common case. Switch tab, bring the form on screen, and put the
   * caret in the first field so the keyboard just works.
   */
  const focusDetails = () => {
    setTab("details");
    // One frame for Radix to mount the panel before measuring/scrolling.
    requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      requestAnimationFrame(() => nameInputRef.current?.focus({ preventScroll: true }));
    });
  };

  const onPickAvatar = async (file: File) => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    let objectUrl: string | null = null;
    try {
      const prepared = await prepareAvatarFile(file);
      objectUrl = URL.createObjectURL(prepared);
      setAvatarPreview(objectUrl);
      const { user: updated, error } = await uploadAvatar(prepared);
      if (error || !updated) {
        setAvatarPreview(null);
        toast.error(error ?? "Could not upload that photo.");
        return;
      }
      setUser(updated);
      toast.success("Profile photo updated");
    } catch (e) {
      setAvatarPreview(null);
      toast.error((e as Error).message);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setAvatarBusy(false);
    }
  };

  const onRemoveAvatar = async () => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    const { user: updated, error } = await removeAvatar();
    setAvatarBusy(false);
    if (error || !updated) {
      toast.error(error ?? "Could not remove that photo.");
      return;
    }
    setAvatarPreview(null);
    setUser(updated);
    toast.success("Back to your initials");
  };

  /* -------------------------------------------------- derived ------ */

  const selectedCollege = colleges.find((c) => c.slug === form.college);
  const months = React.useMemo(monthOptions, []);
  const completion = React.useMemo(() => {
    if (!user) return { done: 0, total: 4, missing: [] as string[] };
    const missing: string[] = [];
    if (!user.name?.trim()) missing.push("Add your name");
    if (!user.phone?.trim()) missing.push("Add a phone number");
    if (!user.collegeSlug) missing.push("Pick your college");
    if (!user.budgetPref) missing.push("Set your monthly budget");
    return { done: 4 - missing.length, total: 4, missing };
  }, [user]);

  if (booting) return <ProfileSkeleton />;

  const avatarSrc = avatarPreview ?? user?.avatar ?? null;

  return (
    <div className="w-full pb-20">
      {/* ---------------------------------------------- banner ---- */}
      <header className="relative">
        <div className="relative h-40 w-full overflow-hidden border-b border-border bg-brand-950 sm:h-52">
          <PixelBanner />
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
            <div className="relative -mt-12 shrink-0 sm:-mt-14">
              <AvatarControl
                src={avatarSrc}
                initials={initialsOf(form.name || user?.name || "?")}
                busy={avatarBusy}
                onPick={onPickAvatar}
                onRemove={onRemoveAvatar}
              />
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl">
                {form.name || user?.name}
              </h1>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{user?.email}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary" className="gap-1.5 rounded-none">
                  <GraduationCap className="size-3" />
                  Student
                </Badge>
                <Badge variant="outline" className="gap-1.5 rounded-none">
                  {user?.provider === "google" ? (
                    <ShieldCheck className="size-3" />
                  ) : (
                    <KeyRound className="size-3" />
                  )}
                  {user?.provider === "google" ? "Google account" : "Email & password"}
                </Badge>
                <span className="font-medium text-muted-foreground">
                  Member since {fullMemberSince(user?.createdAt ?? "")}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 pb-1">
              <Button onClick={focusDetails}>
                <Pencil className="h-4 w-4" />
                Edit details
              </Button>
              <Button
                variant="outline"
                onClick={() => setSignOutOpen(true)}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Sign out</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6">

      {/* ------------------------------------------------ body ----- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left rail */}
        <aside className="lg:col-span-4">
          <div className="flex flex-col gap-6 lg:sticky lg:top-6">
            {/* Profile strength */}
            <Card className="gap-4 rounded-none py-5">
              <CardHeader className="px-5">
                <CardTitle className="text-base">Profile strength</CardTitle>
                <CardDescription>
                  {completion.missing.length === 0
                    ? "Your profile is complete. Owners can reach you faster."
                    : "A fuller profile means better matches near you."}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold tracking-tight text-foreground">
                    {Math.round((completion.done / completion.total) * 100)}%
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {completion.done} of {completion.total} complete
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={completion.done}
                  aria-valuemin={0}
                  aria-valuemax={completion.total}
                  className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-linear-to-r from-brand-500 to-brand-700 transition-[width] duration-500"
                    style={{
                      width: `${(completion.done / completion.total) * 100}%`,
                    }}
                  />
                </div>
                {completion.missing.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-2">
                    {completion.missing.map((item) => (
                      <li
                        key={item}
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                          <X className="h-3 w-3 text-muted-foreground" />
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Account facts */}
            <Card className="gap-0 rounded-none py-0">
              <CardHeader className="px-5 pt-5 pb-4">
                <CardTitle className="text-base">Account</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 px-5 pb-5">
                <Row
                  icon={<UserRound className="h-4 w-4" />}
                  label="Email"
                  value={user?.email ?? ""}
                  action={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      aria-label="Copy email"
                      onClick={copyEmail}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  }
                />
                <Separator />
                <Row
                  icon={<KeyRound className="h-4 w-4" />}
                  label="Sign-in method"
                  value={
                    user?.provider === "google" ? "Google" : "Email & password"
                  }
                />
                <Separator />
                <Row
                  icon={<Building2 className="h-4 w-4" />}
                  label="College"
                  value={selectedCollege?.name ?? "Not set"}
                />
                <Separator />
                <Row
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Member since"
                  value={memberSince(user?.createdAt ?? "")}
                />
              </CardContent>
            </Card>

            {/* Owner promo */}
            <Card className="gap-3 rounded-none border-brand-200 bg-brand-50 py-5 shadow-none">
              <CardHeader className="px-5">
                <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-accent-400 text-slate-900">
                  <Sparkles className="h-4 w-4" />
                </div>
                <CardTitle className="text-base">Own a PG?</CardTitle>
                <CardDescription className="text-slate-600">
                  Reach verified students near your property — you stay in control of
                  pricing and availability.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-5">
                <Button asChild className="w-full">
                  <a href="/for-owners">List your property</a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </aside>

        {/* Main column */}
        <div className="lg:col-span-8">
          <Tabs value={tab} onValueChange={setTab} className="gap-6">
            <TabsList className="h-11 w-full sm:w-fit">
              <TabsTrigger value="details" className="gap-2">
                <UserRound className="h-4 w-4" />
                Details
              </TabsTrigger>
              <TabsTrigger value="saved" className="gap-2">
                <Bookmark className="h-4 w-4" />
                Saved PGs
                {savedIds.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800">
                    {savedIds.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ---------------- details ---------------- */}
            <TabsContent value="details">
              <Card ref={detailsRef} className="gap-0 rounded-none py-0">
                <CardHeader className="border-b px-5 py-5 sm:px-6">
                  <CardTitle>Personal details</CardTitle>
                  <CardDescription>
                    Used to match you with PGs near campus and to let owners reach you.
                  </CardDescription>
                </CardHeader>
                <form onSubmit={onSubmit} noValidate>
                  <CardContent className="flex flex-col gap-5 px-5 py-6 sm:px-6">
                    {formError && (
                      <Alert variant="destructive">
                        <AlertDescription>{formError}</AlertDescription>
                      </Alert>
                    )}

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field
                        id="name"
                        label="Full name"
                        hint="Shown on enquiries you send to owners."
                        error={nameError ?? undefined}
                      >
                        <div className="relative">
                          <UserRound className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="name"
                            name="name"
                            ref={nameInputRef}
                            autoComplete="name"
                            className="h-11 pl-10"
                            placeholder="Riya Sharma"
                            value={form.name}
                            aria-invalid={Boolean(nameError)}
                            onChange={(e) => patch({ name: e.target.value })}
                          />
                        </div>
                      </Field>

                      <Field
                        id="phone"
                        label="Phone"
                        optional
                        hint="Optional — only shared with an owner you contact."
                        error={phoneError ?? undefined}
                      >
                        <div className="relative">
                          <Phone className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="phone"
                            name="phone"
                            type="tel"
                            autoComplete="tel"
                            className="h-11 pl-10"
                            placeholder="+91 98765 43210"
                            value={form.phone}
                            aria-invalid={Boolean(phoneError)}
                            onChange={(e) => patch({ phone: e.target.value })}
                          />
                        </div>
                      </Field>
                    </div>

                    <Field
                      id="college"
                      label="Your college"
                      hint="We prioritise PGs within your usual commute of campus."
                    >
                      <Select
                        value={form.college}
                        onValueChange={(value) => patch({ college: value })}
                      >
                        <SelectTrigger id="college" className="h-11 w-full">
                          <SelectValue placeholder="Choose your college" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_COLLEGE}>
                            Not in college yet / prefer not to say
                          </SelectItem>
                          {colleges.map((college) => (
                            <SelectItem key={college.slug} value={college.slug}>
                              {college.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Separator className="my-1" />

                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        Your hunt preferences
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        These pre-fill your enquiries and help us rank PGs that actually
                        fit — owners see them only when you send an enquiry.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                      <Field id="city" label="City">
                        <Input
                          id="city"
                          name="city"
                          className="h-11"
                          placeholder="Delhi"
                          autoComplete="address-level2"
                          value={form.city}
                          onChange={(e) => patch({ city: e.target.value })}
                        />
                      </Field>

                      <Field id="moving-in" label="Moving in">
                        <Select
                          value={form.movingInMonth}
                          onValueChange={(value) => patch({ movingInMonth: value })}
                        >
                          <SelectTrigger id="moving-in" className="h-11 w-full">
                            <SelectValue placeholder="Not sure yet" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_MONTH}>Not sure yet</SelectItem>
                            {months.map((month) => (
                              <SelectItem key={month.value} value={month.value}>
                                {month.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field id="budget" label="Monthly budget">
                        <Select
                          value={form.budgetPref}
                          onValueChange={(value) => patch({ budgetPref: value })}
                        >
                          <SelectTrigger id="budget" className="h-11 w-full">
                            <SelectValue placeholder="Any budget" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_BUDGET}>Any budget</SelectItem>
                            {BUDGET_OPTIONS.map((budget) => (
                              <SelectItem key={budget.value} value={budget.value}>
                                {budget.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field
                        id="availability"
                        label="When can you visit?"
                        optional
                        hint="Helps an owner suggest a good time."
                      >
                        <Input
                          id="availability"
                          name="availability"
                          className="h-11"
                          placeholder="Weekends, after 5 pm"
                          value={form.availability}
                          onChange={(e) => patch({ availability: e.target.value })}
                        />
                      </Field>

                      <Field
                        id="message"
                        label="Message to owners"
                        optional
                        hint="Pre-fills the enquiry form on every PG."
                      >
                        <Textarea
                          id="message"
                          name="messageToOwners"
                          rows={3}
                          maxLength={500}
                          placeholder="Hi! I'm a DTU student looking for a quiet double-sharing room."
                          value={form.messageToOwners}
                          onChange={(e) => patch({ messageToOwners: e.target.value })}
                        />
                      </Field>
                    </div>
                  </CardContent>

                  <div className="flex flex-col gap-3 border-t bg-muted/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="text-xs text-muted-foreground">
                      {dirty ? (
                        <span className="flex items-center gap-1.5 font-medium text-brand-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
                          You have unsaved changes
                        </span>
                      ) : (
                        "Everything is up to date."
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={!dirty || saving}
                        onClick={resetForm}
                      >
                        Discard
                      </Button>
                      <Button type="submit" disabled={!dirty || saving}>
                        {saving ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Saving…
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4" />
                            Save changes
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </form>
              </Card>
            </TabsContent>

            {/* ---------------- saved ---------------- */}
            <TabsContent value="saved">
              <Card className="gap-0 rounded-none py-0">
                <CardHeader className="border-b px-5 py-5 sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>Saved PGs</CardTitle>
                      <CardDescription>
                        {savedIds.length === 0
                          ? "Nothing in your shortlist yet."
                          : `${savedIds.length} ${savedIds.length === 1 ? "PG" : "PGs"} in your shortlist.`}
                      </CardDescription>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <a href="/saved">
                        <Bookmark className="h-4 w-4" />
                        Open
                      </a>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-5 py-6 sm:px-6">
                  {savedLoading ? (
                    <SavedSkeleton />
                  ) : savedIds.length === 0 ? (
                    <EmptySaved />
                  ) : (
                    <div
                      ref={attachSavedGrid}
                      onClick={onSavedGridClick}
                      className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Mobile-only account footer */}
          <div className="mt-6 flex items-center justify-between gap-4 border border-border bg-card px-5 py-4 lg:hidden">
            <p className="text-xs text-muted-foreground">
              Signed in as {user?.email}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setSignOutOpen(true)}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------- sign out ------- */}
      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out of PG Hunter?</DialogTitle>
            <DialogDescription>
              Your saved shortlist stays safe — you'll just need to sign in again to
              see it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSignOutOpen(false)}
              disabled={signingOut}
            >
              Stay signed in
            </Button>
            <Button
              variant="destructive"
              onClick={onSignOut}
              disabled={signingOut}
            >
              {signingOut ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing out…
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4" />
                  Sign out
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- */
/* Small local building blocks                                      */
/* --------------------------------------------------------------- */

/** Longest edge we keep. Avatars render at 96px; 512 gives retina headroom. */
const AVATAR_MAX_EDGE = 512;
const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Downscale in the browser before uploading.
 *
 * A modern phone photo is several MB; resizing to a square-ish 512px box and
 * re-encoding keeps uploads small and snappy, and means a user on mobile data
 * is not punished for picking a 48MP camera roll image. WebP is preferred, with
 * a JPEG fallback for the (rare) browsers without a webp encoder.
 */
const prepareAvatarFile = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image could not be read.");
  });
  const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.85)
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
    type: "image/webp",
  });
};

interface AvatarControlProps {
  src: string | null;
  initials: string;
  busy: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}

function AvatarControl({ src, initials, busy, onPick, onRemove }: AvatarControlProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  // A stored URL can be unreachable (object removed, expired Google picture,
  // offline). When it is, fall back to the initials layer instead of leaving
  // the browser's broken-image icon on a blank square. Keyed on `src` so a
  // fresh upload gets another chance to render.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div className="group relative">
      <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-none border-2 border-background bg-brand-100 text-3xl font-extrabold tracking-tight text-brand-800 shadow-card sm:h-28 sm:w-28 sm:text-4xl">
          {src && showImage ? (
            <img
              src={src}
              alt=""
              className="h-full w-full object-cover"
              width={112}
              height={112}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setFailedSrc(src)}
            />
          ) : (
            <span aria-hidden="true">{initials}</span>
          )}

          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Loader2 className="size-5 animate-spin text-brand-700" />
            </span>
          )}

          {/* Hover/focus overlay: the whole avatar is the upload target. */}
          {!busy && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-brand-950/70 text-[11px] font-semibold text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              <ImageUp className="size-5" />
              <span>{src ? "Change" : "Upload"}</span>
            </button>
          )}
        </div>

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        // The visible Upload button is the real control and opens this
        // programmatically. Leaving the input focusable/announced would add a
        // second, nameless "Choose file" stop to keyboard and screen-reader use.
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file twice still fires a change event.
          event.target.value = "";
          if (file) void onPick(file);
        }}
      />

      {src && !busy && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRemove}
          className="absolute -right-2 -bottom-2 h-8 w-8 rounded-none border-border bg-background p-0 text-muted-foreground hover:text-destructive"
          aria-label="Remove profile photo"
          title="Remove photo"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-semibold text-foreground">
          {label}
        </Label>
        {optional && (
          <span className="text-xs font-normal text-muted-foreground">Optional</span>
        )}
      </div>
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold text-foreground">{value}</p>
      </div>
      {action}
    </div>
  );
}

function EmptySaved() {
  return (
    <div className="flex flex-col items-center border border-dashed bg-muted/40 px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center bg-brand-100 text-brand-700">
        <Bookmark className="h-6 w-6" />
      </div>
      <p className="mt-4 text-base font-bold text-foreground">Nothing saved yet</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Tap the bookmark on any PG to build your shortlist. We'll keep it here for
        you.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <a href="/pgs-near-you">
            <Search className="h-4 w-4" />
            Browse PGs
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href="/saved">View shortlist</a>
        </Button>
      </div>
    </div>
  );
}

function SavedSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 overflow-hidden border">
          <Skeleton className="aspect-4/3 w-full rounded-none" />
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="mt-2 h-11 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="w-full pb-20" role="status" aria-label="Loading your profile">
      <Skeleton className="h-40 w-full rounded-none sm:h-52" />
      <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
          <Skeleton className="-mt-12 h-24 w-24 rounded-none sm:-mt-14 sm:h-28 sm:w-28" />
          <div className="flex-1 pb-1">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="mt-2 h-4 w-72" />
            <Skeleton className="mt-3 h-5 w-80" />
          </div>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-4">
            <Skeleton className="h-56 w-full rounded-none" />
            <Skeleton className="h-72 w-full rounded-none" />
          </div>
          <div className="lg:col-span-8">
            <Skeleton className="h-11 w-64 rounded-lg" />
            <Skeleton className="mt-6 h-96 w-full rounded-none" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading your profile…</span>
    </div>
  );
}

export default function ProfileAppRoot(props: Props) {
  // Sonner's <Toaster> calls React hooks during server rendering, and under the
  // Cloudflare/workerd SSR renderer that throws ("Invalid hook call") and turns
  // the whole page into a 500. It is a pure client overlay, so mount it only
  // after hydration instead.
  //
  // Theme is pinned to "light" rather than wrapped in a next-themes provider:
  // PG Hunter is light-only, and that provider renders its own inline
  // <script>, which the strict `script-src 'self'` CSP rejects.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <>
      {mounted && (
        <Toaster theme="light" position="bottom-center" richColors closeButton />
      )}
      <ProfileApp {...props} />
    </>
  );
}