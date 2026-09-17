"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileBadge, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import { deleteEmployeeDocumentAction, uploadEmployeeDocumentAction } from "@/app/actions/employees";
import type { EmployeeDocumentDTO } from "@/lib/services/employees";
import { EMPLOYEE_DOC_KIND_LABEL, EMPLOYEE_DOC_MAX_BYTES, EMPLOYEE_DOC_MAX_COUNT } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/app/field";
import { NativeSelect } from "@/components/app/native-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmployeeDocuments({ employeeId, documents }: { employeeId: string; documents: EmployeeDocumentDTO[] }) {
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<keyof typeof EMPLOYEE_DOC_KIND_LABEL>(
    documents.some((d) => d.kind === "AADHAAR_FRONT") ? (documents.some((d) => d.kind === "AADHAAR_BACK") ? "OTHER" : "AADHAAR_BACK") : "AADHAAR_FRONT",
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [toDelete, setToDelete] = useState<EmployeeDocumentDTO | null>(null);
  const [deleting, startDelete] = useTransition();
  const full = documents.length >= EMPLOYEE_DOC_MAX_COUNT;

  const upload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a photo or PDF first.");
    if (file.size > EMPLOYEE_DOC_MAX_BYTES) return setError(`File is too large. Maximum size is ${Math.round(EMPLOYEE_DOC_MAX_BYTES / 1024 / 1024)} MB.`);
    const fd = new FormData();
    fd.set("employeeId", employeeId);
    fd.set("kind", kind);
    fd.set("file", file);
    start(async () => {
      const res = await uploadEmployeeDocumentAction(fd);
      if (!res.ok) {
        setError(res.fieldErrors?.file ?? res.error);
        return;
      }
      toast.success("Document uploaded", { description: `${EMPLOYEE_DOC_KIND_LABEL[res.data.kind]} · ${res.data.fileName}` });
      if (fileRef.current) fileRef.current.value = "";
      setFileName(null);
      router.refresh();
    });
  };

  const remove = () => {
    if (!toDelete) return;
    const doc = toDelete;
    startDelete(async () => {
      const res = await deleteEmployeeDocumentAction(employeeId, doc.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Document deleted", { description: doc.fileName });
      setToDelete(null);
      router.refresh();
    });
  };

  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="flex items-center gap-2 font-heading text-lg">
        <FileBadge className="size-4.5 text-primary" /> Aadhaar &amp; documents
        <span className="text-sm font-normal text-muted-foreground">
          ({documents.length}/{EMPLOYEE_DOC_MAX_COUNT})
        </span>
      </h2>

      {documents.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {documents.map((d) => (
            <li key={d.id} className="overflow-hidden rounded-2xl border bg-card shadow-xs">
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="block bg-muted/40" title="Open in a new tab">
                {d.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.url} alt={EMPLOYEE_DOC_KIND_LABEL[d.kind]} className="h-40 w-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-40 items-center justify-center text-muted-foreground">
                    <FileText className="size-10" />
                  </span>
                )}
              </a>
              <div className="flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{EMPLOYEE_DOC_KIND_LABEL[d.kind]}</p>
                  <p className="truncate text-xs text-muted-foreground" title={d.fileName}>
                    {d.fileName} · {formatSize(d.sizeBytes)} · {formatDate(d.createdAt)}
                  </p>
                </div>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${d.fileName}`} onClick={() => setToDelete(d)}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No documents yet. Upload the Aadhaar card front and back below.</p>
      )}

      <form onSubmit={upload} className="rounded-2xl border bg-card p-4 shadow-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Document type" htmlFor={`${id}-kind`}>
            <NativeSelect id={`${id}-kind`} className="h-11" value={kind} onChange={(e) => setKind(e.target.value as keyof typeof EMPLOYEE_DOC_KIND_LABEL)} disabled={full || pending}>
              {Object.entries(EMPLOYEE_DOC_KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Photo or PDF" htmlFor={`${id}-file`} error={error ?? undefined} hint={full ? `Maximum ${EMPLOYEE_DOC_MAX_COUNT} documents reached. Delete one to upload another.` : "JPG, PNG, WebP or PDF, up to 4 MB. On a phone you can take a photo directly."}>
            <input
              ref={fileRef}
              id={`${id}-file`}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={full || pending}
              onChange={(e) => {
                setError(null);
                setFileName(e.target.files?.[0]?.name ?? null);
              }}
              className="block h-11 w-full rounded-lg border border-input bg-background text-sm file:mr-3 file:h-full file:border-0 file:bg-muted file:px-3 file:text-sm file:font-medium disabled:opacity-50"
            />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button type="submit" size="lg" className="h-11" disabled={full || pending || !fileName}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Upload />} Upload
          </Button>
        </div>
      </form>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>{toDelete ? `"${toDelete.fileName}" will be permanently removed.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={deleting} variant="destructive">
              {deleting ? <LoaderCircle className="animate-spin" /> : null} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
