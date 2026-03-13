"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LogEntry {
  timestamp: string;
  status: string;
  message: string;
}

type Stage =
  | "idle"
  | "reading"
  | "schema"
  | "extracting"
  | "finalizing"
  | "done"
  | "error";

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGES_PER_CHUNK = 5;
const SAMPLE_PAGE_COUNT = 8;
const RENDER_SCALE = 150 / 72; // 150 DPI
const CONCURRENCY = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDocument = any;

async function loadPdfJs(): Promise<{ getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> }; GlobalWorkerOptions: { workerSrc: string } }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf" as string);
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

async function renderPageToBase64(pdfDoc: PdfDocument, pageNum: number): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1];
}

async function extractPageText(pdfDoc: PdfDocument, pageNum: number): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items
    .map((item: { str?: string }) => item.str ?? "")
    .join(" ")
    .trim();
}

function getSamplePageIndices(totalPages: number, count: number): number[] {
  if (totalPages <= count) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const indices = new Set<number>([1, 2, totalPages]);
  const step = Math.floor(totalPages / (count - 2));
  for (let i = 1; indices.size < count && i * step <= totalPages; i++) {
    indices.add(Math.min(i * step, totalPages));
  }
  return Array.from(indices).sort((a, b) => a - b).slice(0, count);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [chunkStatuses, setChunkStatuses] = useState<("pending" | "running" | "done" | "failed")[]>([]);

  function addLog(status: string, message: string) {
    setLog((prev) => [...prev, { timestamp: new Date().toISOString(), status, message }]);
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type === "application/pdf") setFile(dropped);
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked?.type === "application/pdf") setFile(picked);
  }

  // ── Main Pipeline ────────────────────────────────────────────────────────────
  async function startProcessing() {
    if (!file) return;
    abortRef.current = false;
    setStage("reading");
    setLog([]);
    setProgress(0);
    setErrorMsg("");
    setCatalogId(null);
    setChunkStatuses([]);

    try {
      // 1. Load PDF in browser
      addLog("reading", `Loading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
      setProgressLabel("Loading PDF…");

      const pdfjs = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdfDoc.numPages;

      addLog("reading", `PDF loaded: ${totalPages} pages`);
      setProgress(5);

      // 2. Render sample pages for schema discovery
      setStage("schema");
      setProgressLabel("Discovering schema…");
      addLog("schema", "Rendering sample pages for schema discovery…");

      const sampleIndices = getSamplePageIndices(totalPages, SAMPLE_PAGE_COUNT);
      const samplePages = await Promise.all(
        sampleIndices.map(async (pageNum) => ({
          page_number: pageNum,
          image_base64: await renderPageToBase64(pdfDoc, pageNum),
          text: await extractPageText(pdfDoc, pageNum),
        }))
      );

      setProgress(10);
      addLog("schema", `Sending ${samplePages.length} sample pages to Claude for schema discovery…`);

      const schemaRes = await fetch("/api/catalogs/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: samplePages }),
      });

      if (!schemaRes.ok) throw new Error(`Schema discovery failed: ${await schemaRes.text()}`);
      const schema = await schemaRes.json();

      addLog("schema", `Schema discovered: ${schema.columns.length} columns for "${schema.company_name}"`);

      // Create catalog record
      const catalogRes = await fetch("/api/catalogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, schema, total_pages: totalPages }),
      });
      if (!catalogRes.ok) throw new Error(`Failed to create catalog: ${await catalogRes.text()}`);
      const { catalog_id } = await catalogRes.json();
      setCatalogId(catalog_id);
      setProgress(15);

      // 3. Parallel chunk extraction
      setStage("extracting");
      const totalChunks = Math.ceil(totalPages / PAGES_PER_CHUNK);
      addLog("extracting", `Extracting ${totalPages} pages in ${totalChunks} chunks (${CONCURRENCY} concurrent)…`);

      setChunkStatuses(Array(totalChunks).fill("pending"));

      let completedChunks = 0;

      async function processChunk(chunkIdx: number) {
        if (abortRef.current) return;

        setChunkStatuses((prev) => {
          const next = [...prev];
          next[chunkIdx] = "running";
          return next;
        });

        const startPage = chunkIdx * PAGES_PER_CHUNK + 1;
        const endPage = Math.min(startPage + PAGES_PER_CHUNK - 1, totalPages);

        const pages = await Promise.all(
          Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i).map(
            async (pageNum) => ({
              page_number: pageNum,
              image_base64: await renderPageToBase64(pdfDoc, pageNum),
              text: await extractPageText(pdfDoc, pageNum),
            })
          )
        );

        const chunkRes = await fetch(`/api/catalogs/${catalog_id}/extract-chunk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pages,
            schema,
            category_context: "",
            chunk_index: chunkIdx,
            total_chunks: totalChunks,
          }),
        });

        if (chunkRes.ok) {
          const chunkData = await chunkRes.json();
          addLog("extracting", `Chunk ${chunkIdx + 1}/${totalChunks}: ${chunkData.products_found} products`);
          setChunkStatuses((prev) => {
            const next = [...prev];
            next[chunkIdx] = "done";
            return next;
          });
        } else {
          addLog("extracting", `Chunk ${chunkIdx + 1}/${totalChunks}: failed (skipping)`);
          setChunkStatuses((prev) => {
            const next = [...prev];
            next[chunkIdx] = "failed";
            return next;
          });
        }

        completedChunks++;
        setProgress(15 + Math.round((completedChunks / totalChunks) * 70));
        setProgressLabel(`Extracted ${completedChunks} / ${totalChunks} chunks…`);
      }

      // Run chunks with concurrency pool
      const queue = Array.from({ length: totalChunks }, (_, i) => i);
      const workers = Array.from({ length: Math.min(CONCURRENCY, totalChunks) }, async () => {
        while (queue.length > 0) {
          const idx = queue.shift()!;
          await processChunk(idx);
        }
      });
      await Promise.all(workers);

      // 4. Finalize
      setStage("finalizing");
      setProgressLabel("Finalizing — building search index…");
      addLog("indexing", "Building full-text search index…");
      setProgress(88);

      const finalRes = await fetch(`/api/catalogs/${catalog_id}/finalize`, { method: "POST" });
      if (!finalRes.ok) throw new Error(`Finalize failed: ${await finalRes.text()}`);
      const { inserted, indexed } = await finalRes.json();

      addLog("completed", `Done! ${inserted} products inserted, ${indexed} indexed for search.`);
      setProgress(100);
      setStage("done");
      setProgressLabel("Processing complete!");
      toast.success("Catalog processed successfully!");

      setTimeout(() => router.push(`/catalog/${catalog_id}`), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStage("error");
      addLog("failed", `Error: ${msg}`);
      toast.error("Processing failed");
    }
  }

  const isProcessing = ["reading", "schema", "extracting", "finalizing"].includes(stage);

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900">Upload Catalog</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Upload a product catalog PDF — AI will extract all products automatically.
        </p>
      </div>

      {/* Drop Zone */}
      {stage === "idle" && (
        <div
          ref={dropRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !file && inputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer ${
            isDragging
              ? "border-indigo-400 bg-indigo-50 scale-[1.01]"
              : file
              ? "border-emerald-300 bg-emerald-50"
              : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            onChange={handleFileChange}
          />

          {file ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                <Icon name="checkCircle" className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <p className="font-semibold text-slate-800">{file.name}</p>
                <p className="text-sm text-slate-400 mt-0.5">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); }}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                Choose a different file
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                <Icon name="upload" className="w-6 h-6 text-slate-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-700">Drop your PDF here</p>
                <p className="text-sm text-slate-400 mt-0.5">or click to browse files</p>
              </div>
              <p className="text-xs text-slate-300">PDF files only</p>
            </div>
          )}
        </div>
      )}

      {/* Feature cards */}
      {stage === "idle" && file && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: "search" as const, title: "Schema Discovery", desc: "Claude infers column structure from sample pages" },
            { icon: "sparkle" as const, title: "Parallel Extraction", desc: `${CONCURRENCY} chunks processed concurrently for speed` },
            { icon: "catalog" as const, title: "Full-Text Index", desc: "PostgreSQL tsvector for instant search" },
          ].map((c) => (
            <Card key={c.title} className="p-4">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center mb-2">
                <Icon name={c.icon} className="w-4 h-4 text-indigo-500" />
              </div>
              <p className="text-xs font-semibold text-slate-700">{c.title}</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{c.desc}</p>
            </Card>
          ))}
        </div>
      )}

      {/* CTA */}
      {stage === "idle" && (
        <div className="mt-6">
          <Button onClick={startProcessing} disabled={!file} className="w-full py-3" size="lg">
            {file ? "Start AI Extraction" : "Select a PDF first"}
          </Button>
        </div>
      )}

      {/* Processing UI */}
      {isProcessing && (
        <ProcessingView
          stage={stage}
          progress={progress}
          progressLabel={progressLabel}
          log={log}
          chunkStatuses={chunkStatuses}
        />
      )}

      {/* Done */}
      {stage === "done" && (
        <Card className="p-6 text-center bg-emerald-50 border-emerald-200">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <Icon name="checkCircle" className="w-6 h-6 text-emerald-500" />
          </div>
          <p className="font-semibold text-emerald-700">Processing complete!</p>
          <p className="text-sm text-emerald-600 mt-1">Redirecting to catalog view…</p>
        </Card>
      )}

      {/* Error */}
      {stage === "error" && (
        <Card className="p-6 bg-red-50 border-red-200">
          <div className="flex items-start gap-3">
            <Icon name="warning" className="w-5 h-5 text-red-400 shrink-0 mt-0.5" strokeWidth={2} />
            <div className="flex-1">
              <p className="font-semibold text-red-700 text-sm">Processing failed</p>
              <p className="text-xs text-red-500 mt-1 break-words">{errorMsg}</p>
            </div>
          </div>
          <Button
            onClick={() => { setStage("idle"); setLog([]); setProgress(0); setChunkStatuses([]); }}
            variant="destructive"
            className="mt-4 w-full"
          >
            Try Again
          </Button>
        </Card>
      )}
    </div>
  );
}

// ─── Processing View ──────────────────────────────────────────────────────────
function ProcessingView({
  stage,
  progress,
  progressLabel,
  log,
  chunkStatuses,
}: {
  stage: Stage;
  progress: number;
  progressLabel: string;
  log: LogEntry[];
  chunkStatuses: ("pending" | "running" | "done" | "failed")[];
}) {
  const stages = [
    { key: "reading", label: "Load PDF" },
    { key: "schema", label: "Discover Schema" },
    { key: "extracting", label: "Extract Products" },
    { key: "finalizing", label: "Finalize" },
  ];
  const activeIdx = stages.findIndex((s) => s.key === stage);

  return (
    <Card className="overflow-hidden">
      {/* Stage steps */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-0">
          {stages.map((s, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            return (
              <div key={s.key} className="flex items-center flex-1 last:flex-none">
                <div className={`flex flex-col items-center gap-1 ${i < stages.length - 1 ? "flex-1" : ""}`}>
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      done
                        ? "bg-emerald-400 text-white"
                        : active
                        ? "bg-indigo-500 text-white ring-4 ring-indigo-100"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {done ? (
                      <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`text-xs font-medium whitespace-nowrap ${active ? "text-indigo-600" : done ? "text-emerald-500" : "text-slate-400"}`}>
                    {s.label}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <div className={`h-px flex-1 mx-2 mb-4 transition-all ${done ? "bg-emerald-300" : "bg-slate-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6 py-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-slate-700">{progressLabel}</p>
          <span className="text-sm font-bold text-indigo-600">{progress}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Chunk status grid */}
      {chunkStatuses.length > 0 && (
        <div className="px-6 py-3 border-b border-slate-100">
          <p className="text-xs font-medium text-slate-400 mb-2">Chunk progress</p>
          <div className="flex flex-wrap gap-1">
            {chunkStatuses.map((s, i) => (
              <div
                key={i}
                title={`Chunk ${i + 1}: ${s}`}
                className={`w-3 h-3 rounded-sm transition-all ${
                  s === "done"
                    ? "bg-emerald-400"
                    : s === "running"
                    ? "bg-indigo-400 animate-pulse"
                    : s === "failed"
                    ? "bg-red-400"
                    : "bg-slate-200"
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Log */}
      <div className="px-6 py-4 max-h-48 overflow-y-auto space-y-1.5">
        {log.length === 0 && (
          <p className="text-xs text-slate-300 italic">Waiting for logs…</p>
        )}
        {[...log].reverse().map((entry, i) => (
          <div key={i} className="flex items-start gap-2">
            <LogDot status={entry.status} />
            <p className="text-xs text-slate-500 leading-relaxed">{entry.message}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LogDot({ status }: { status: string }) {
  const color =
    status === "completed" ? "bg-emerald-400" :
    status === "failed" ? "bg-red-400" :
    status === "extracting" ? "bg-blue-400 animate-pulse" :
    status === "inserting" ? "bg-violet-400 animate-pulse" :
    status === "indexing" ? "bg-indigo-400 animate-pulse" :
    "bg-slate-300";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${color}`} />;
}
