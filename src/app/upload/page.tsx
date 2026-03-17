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
  | "fingerprinting"
  | "reading"
  | "schema"
  | "extracting"
  | "finalizing"
  | "done"
  | "done_with_warnings"
  | "error";

import { classifyPage, classifyCatalog, getSkippablePages, getExtractablePages } from "@/lib/catalog-classifier";
import type { PageClassification } from "@/lib/catalog-classifier";

// ─── Constants ────────────────────────────────────────────────────────────────
const SAMPLE_PAGE_COUNT = 8;
const RENDER_SCALE = 150 / 72; // 150 DPI
const CONCURRENCY = 4;
const MATCH_THRESHOLD = 70;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 9000]; // exponential backoff

// ─── Helpers ──────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDocument = any;

async function loadPdfJs(): Promise<{ getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> }; GlobalWorkerOptions: { workerSrc: string } }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf" as string);
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024; // 4.5MB limit (Claude max is 5MB, leave headroom)

async function renderPageToBase64(pdfDoc: PdfDocument, pageNum: number): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Try JPEG first (much smaller), fall back to lower quality if still too large
  for (const quality of [0.85, 0.7, 0.5]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.split(",")[1];
    const sizeBytes = Math.ceil(base64.length * 0.75); // base64 → bytes
    if (sizeBytes <= MAX_IMAGE_BYTES) return base64;
  }

  // Last resort: scale down the canvas by 50% and retry
  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = Math.round(canvas.width / 2);
  smallCanvas.height = Math.round(canvas.height / 2);
  const smallCtx = smallCanvas.getContext("2d")!;
  smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
  const dataUrl = smallCanvas.toDataURL("image/jpeg", 0.7);
  return dataUrl.split(",")[1];
}

/**
 * P1-4: Upload with retry (1 retry with 1s delay before giving up).
 */
async function uploadPageImageToS3(s3Key: string, base64: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // increased to 30s
      const res = await fetch("/api/upload-page-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: s3Key, image_base64: base64, content_type: "image/jpeg" }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 1000)); continue; }
        return null;
      }
      const { url } = await res.json();
      return url;
    } catch {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      return null;
    }
  }
  return null;
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

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeContentHash(texts: string[]): Promise<string> {
  const combined = texts
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(combined);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Catalog classification is now handled by @/lib/catalog-classifier
// imported at top of file

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Upload Job Interface ─────────────────────────────────────────────────────
type ChunkStatus = "pending" | "running" | "done" | "failed" | "truncated";

interface UploadJob {
  id: string;
  fileName: string;
  fileSize: number;
  stage: Stage;
  progress: number;
  progressLabel: string;
  log: LogEntry[];
  catalogId: string | null;
  errorMsg: string;
  warningMsg: string;
  chunkStatuses: ChunkStatus[];
  collapsed: boolean;
}

function createJobId(): string {
  return crypto.randomUUID();
}

function createJob(file: File): UploadJob {
  return {
    id: createJobId(),
    fileName: file.name,
    fileSize: file.size,
    stage: "idle",
    progress: 0,
    progressLabel: "",
    log: [],
    catalogId: null,
    errorMsg: "",
    warningMsg: "",
    chunkStatuses: [],
    collapsed: false,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  // Mutable ref for jobs — async pipeline reads/writes this to avoid stale closures
  const jobsRef = useRef<Map<string, UploadJob>>(new Map());
  // Store abort flags per job
  const abortRefs = useRef<Map<string, boolean>>(new Map());

  // Push ref state to React state for rendering
  function syncJobs() {
    setJobs(Array.from(jobsRef.current.values()));
  }

  // Update a single job in the ref and sync
  function updateJob(jobId: string, updates: Partial<UploadJob>) {
    const existing = jobsRef.current.get(jobId);
    if (!existing) return;
    const updated = { ...existing, ...updates };
    jobsRef.current.set(jobId, updated);
    syncJobs();
  }

  // Append a log entry to a job
  function addJobLog(jobId: string, status: string, message: string) {
    const existing = jobsRef.current.get(jobId);
    if (!existing) return;
    const newLog: LogEntry = { timestamp: new Date().toISOString(), status, message };
    const updated = { ...existing, log: [...existing.log, newLog] };
    jobsRef.current.set(jobId, updated);
    syncJobs();
  }

  // Update chunk statuses for a job
  function updateJobChunkStatus(jobId: string, chunkIdx: number, status: ChunkStatus) {
    const existing = jobsRef.current.get(jobId);
    if (!existing) return;
    const next = [...existing.chunkStatuses];
    next[chunkIdx] = status;
    const updated = { ...existing, chunkStatuses: next };
    jobsRef.current.set(jobId, updated);
    syncJobs();
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
    if (dropped?.type === "application/pdf") {
      handleNewFile(dropped);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked?.type === "application/pdf") {
      handleNewFile(picked);
    }
    // Reset so the same file can be picked again
    if (inputRef.current) inputRef.current.value = "";
  }

  // ── Start a new upload job when a file is added ──────────────────────────────
  function handleNewFile(file: File) {
    const job = createJob(file);
    jobsRef.current.set(job.id, job);
    abortRefs.current.set(job.id, false);
    syncJobs();
    // Start the pipeline for this job
    runJobPipeline(job.id, file);
  }

  // ── Toggle collapse on a job card ────────────────────────────────────────────
  function toggleJobCollapse(jobId: string) {
    const existing = jobsRef.current.get(jobId);
    if (!existing) return;
    updateJob(jobId, { collapsed: !existing.collapsed });
  }

  // ── Remove a completed/failed job card ───────────────────────────────────────
  function removeJob(jobId: string) {
    jobsRef.current.delete(jobId);
    abortRefs.current.delete(jobId);
    syncJobs();
  }

  // ── Retry a failed job ───────────────────────────────────────────────────────
  function retryJob(jobId: string, file: File) {
    // Remove old job and start fresh
    jobsRef.current.delete(jobId);
    abortRefs.current.delete(jobId);
    handleNewFile(file);
  }

  // ── Main Pipeline (per job) ──────────────────────────────────────────────────
  async function runJobPipeline(jobId: string, file: File) {
    // ── Fingerprinting ──────────────────────────────────────────────────────
    updateJob(jobId, { stage: "fingerprinting", progress: 0, log: [], errorMsg: "", warningMsg: "" });
    addJobLog(jobId, "fingerprinting", "Computing PDF fingerprint...");
    updateJob(jobId, { progressLabel: "Checking for duplicates..." });

    let fingerprintData: {
      file_hash: string;
      content_hash: string;
      text_sample: string;
      page_count: number;
      file_size: number;
    } | null = null;

    try {
      const fileHash = await computeFileHash(file);
      updateJob(jobId, { progress: 2 });

      const pdfjs = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdfDocForFp = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const pageCount = pdfDocForFp.numPages;

      const pagesToSample = Math.min(3, pageCount);
      const texts: string[] = [];
      for (let i = 1; i <= pagesToSample; i++) {
        texts.push(await extractPageText(pdfDocForFp, i));
      }

      const contentHash = await computeContentHash(texts);
      const textSample = texts.join(" ").slice(0, 2000);

      fingerprintData = {
        file_hash: fileHash,
        content_hash: contentHash,
        text_sample: textSample,
        page_count: pageCount,
        file_size: file.size,
      };
      updateJob(jobId, { progress: 4 });

      addJobLog(jobId, "fingerprinting", "Checking for existing catalogs...");

      const fpRes = await fetch("/api/fingerprint/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_hash: fileHash,
          content_hash: contentHash,
          file_name: file.name,
          page_count: pageCount,
          file_size: file.size,
          text_sample: textSample,
        }),
      });

      if (fpRes.ok) {
        const { best_match } = await fpRes.json();
        if (best_match && best_match.confidence >= MATCH_THRESHOLD && best_match.processing_status === "completed") {
          // Auto-proceed: log the match but continue processing
          addJobLog(jobId, "fingerprinting", `Match found: "${best_match.catalog_name}" (${best_match.confidence}% confidence) — processing anyway.`);
        } else {
          addJobLog(jobId, "fingerprinting", "No existing match found — proceeding with new processing.");
        }
      } else {
        addJobLog(jobId, "fingerprinting", "Fingerprint check unavailable, proceeding with processing...");
      }
    } catch {
      addJobLog(jobId, "fingerprinting", "Fingerprint check failed, proceeding...");
    }

    // ── Main extraction pipeline ────────────────────────────────────────────
    if (abortRefs.current.get(jobId)) return;

    updateJob(jobId, { stage: "reading", progress: 5 });

    try {
      // 1. Load PDF in browser
      addJobLog(jobId, "reading", `Loading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);
      updateJob(jobId, { progressLabel: "Loading PDF..." });

      const pdfjs = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdfDoc.numPages;

      addJobLog(jobId, "reading", `PDF loaded: ${totalPages} pages`);
      updateJob(jobId, { progress: 5 });

      // 2. Render sample pages for schema discovery
      updateJob(jobId, { stage: "schema", progressLabel: "Rendering & uploading sample pages..." });
      addJobLog(jobId, "schema", "Rendering sample pages for schema discovery...");

      const sampleIndices = getSamplePageIndices(totalPages, SAMPLE_PAGE_COUNT);

      const samplePages: { page_number: number; image_base64: string; text: string }[] = [];
      const sampleClassifications: PageClassification[] = [];
      for (const pageNum of sampleIndices) {
        const base64 = await renderPageToBase64(pdfDoc, pageNum);
        const text = await extractPageText(pdfDoc, pageNum);
        samplePages.push({ page_number: pageNum, image_base64: base64, text });
        sampleClassifications.push(classifyPage(pageNum, text, totalPages));
      }

      // Classify catalog type and determine chunk sizing
      const classification = classifyCatalog(sampleClassifications);
      const pagesPerChunk = classification.pages_per_chunk;

      addJobLog(jobId, "schema", `Catalog type: ${classification.catalog_type} (${Math.round(classification.confidence * 100)}% confidence)`);
      if (pagesPerChunk === 1) {
        addJobLog(jobId, "schema", `Dense catalog detected — using 1 page per chunk for accuracy`);
      } else if (pagesPerChunk === 3) {
        addJobLog(jobId, "schema", `Light image catalog — using 3 pages per chunk for speed`);
      }

      updateJob(jobId, { progress: 10 });
      addJobLog(jobId, "schema", `Sending ${samplePages.length} sample pages to Claude for schema discovery...`);

      const schemaRes = await fetch("/api/catalogs/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: samplePages, total_pages: totalPages }),
      });

      if (!schemaRes.ok) throw new Error(`Schema discovery failed: ${await schemaRes.text()}`);
      const schemaResponse = await schemaRes.json();

      // Server may return classification from schema route — use it if available
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { classification: _serverClassification, ...schema } = schemaResponse;

      addJobLog(jobId, "schema", `Schema discovered: ${schema.columns.length} columns for "${schema.company_name}"`);

      // Create catalog record
      const catalogPayload: Record<string, unknown> = {
        file_name: file.name,
        schema,
        total_pages: totalPages,
      };
      if (fingerprintData) {
        catalogPayload.fingerprint = {
          file_hash: fingerprintData.file_hash,
          file_size: fingerprintData.file_size,
          content_hash: fingerprintData.content_hash,
          text_sample: fingerprintData.text_sample,
        };
      }

      const catalogRes = await fetch("/api/catalogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(catalogPayload),
      });
      if (!catalogRes.ok) throw new Error(`Failed to create catalog: ${await catalogRes.text()}`);
      const { catalog_id } = await catalogRes.json();
      updateJob(jobId, { catalogId: catalog_id, progress: 15 });

      // 3. Build page list with intelligent page classification
      updateJob(jobId, { stage: "extracting" });

      // Classify ALL pages — for pages we have text, use full classification; others default to "product"
      const allPageTexts = new Map<number, string>();
      const allPageClassifications = new Map<number, PageClassification>();
      for (const sp of samplePages) {
        allPageTexts.set(sp.page_number, sp.text);
      }
      for (const pc of sampleClassifications) {
        allPageClassifications.set(pc.page_number, pc);
      }

      // For non-sampled pages, classify by extracting text (quick)
      for (let p = 1; p <= totalPages; p++) {
        if (!allPageTexts.has(p)) {
          try {
            const text = await extractPageText(pdfDoc, p);
            allPageTexts.set(p, text);
            allPageClassifications.set(p, classifyPage(p, text, totalPages));
          } catch {
            // If text extraction fails, assume product page
          }
        }
      }

      // Determine skippable pages
      const allClassifications = Array.from(allPageClassifications.values());
      const skippedPages = getSkippablePages(allClassifications);
      const pagesToProcess = getExtractablePages(allClassifications);

      // For pages without classification, include them
      for (let p = 1; p <= totalPages; p++) {
        if (!allPageClassifications.has(p) && !pagesToProcess.includes(p)) {
          pagesToProcess.push(p);
        }
      }
      pagesToProcess.sort((a, b) => a - b);

      if (skippedPages.length > 0) {
        const skippedDetail = skippedPages.map((p) => {
          const pc = allPageClassifications.get(p);
          return `${p}(${pc?.page_type ?? "unknown"})`;
        }).join(", ");
        addJobLog(jobId, "extracting", `Skipping ${skippedPages.length} non-content pages: ${skippedDetail}`);
      }

      // Build chunks from processable pages
      const chunks: number[][] = [];
      for (let i = 0; i < pagesToProcess.length; i += pagesPerChunk) {
        chunks.push(pagesToProcess.slice(i, i + pagesPerChunk));
      }

      const totalChunks = chunks.length;
      addJobLog(jobId, "extracting", `Extracting ${pagesToProcess.length} pages in ${totalChunks} chunks (${CONCURRENCY} concurrent)...`);

      updateJob(jobId, { chunkStatuses: Array(totalChunks).fill("pending") });

      let completedChunks = 0;
      let failedChunkCount = 0;
      let truncatedChunkCount = 0;
      let reextractedPageCount = 0;
      let filteredProductCount = 0;

      // P0-2: Process chunk with retry and exponential backoff
      async function processChunkWithRetry(chunkIdx: number, pageNums: number[]) {
        if (abortRefs.current.get(jobId)) return;

        updateJobChunkStatus(jobId, chunkIdx, "running");

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            // Render pages
            const pages: { page_number: number; image_url?: string; image_base64?: string; text: string }[] = [];
            for (const pageNum of pageNums) {
              const base64 = await renderPageToBase64(pdfDoc, pageNum);
              const text = await extractPageText(pdfDoc, pageNum);
              const s3Key = `catalogs/${catalog_id}/pages/page-${pageNum}.jpg`;
              const imageUrl = await uploadPageImageToS3(s3Key, base64);
              if (imageUrl) {
                pages.push({ page_number: pageNum, image_url: imageUrl, text });
              } else {
                pages.push({ page_number: pageNum, image_base64: base64, text });
              }
            }

            // P0-3: Build category context from the page immediately before this chunk
            const firstPageNum = pageNums[0];
            let precedingPageText = "";
            if (firstPageNum > 1) {
              const prevPageNum = firstPageNum - 1;
              if (allPageTexts.has(prevPageNum)) {
                precedingPageText = allPageTexts.get(prevPageNum)!.slice(0, 500);
              } else {
                try {
                  const text = await extractPageText(pdfDoc, prevPageNum);
                  allPageTexts.set(prevPageNum, text);
                  precedingPageText = text.slice(0, 500);
                } catch {
                  // Non-critical
                }
              }
            }

            // Gather page classifications for this chunk
            const chunkPageClassifications = pageNums
              .map((pn) => allPageClassifications.get(pn))
              .filter((pc): pc is PageClassification => pc != null);

            const chunkRes = await fetch(`/api/catalogs/${catalog_id}/extract-chunk`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pages,
                schema,
                category_context: precedingPageText
                  ? `[Text from preceding page ${firstPageNum - 1}]: ${precedingPageText}`
                  : "",
                chunk_index: chunkIdx,
                total_chunks: totalChunks,
                catalog_type: classification.catalog_type,
                page_classifications: chunkPageClassifications,
              }),
            });

            if (chunkRes.ok) {
              const chunkData = await chunkRes.json();
              const qualityLabel = chunkData.quality === "poor" ? " [LOW QUALITY]" : chunkData.quality === "acceptable" ? " [OK]" : "";
              filteredProductCount += chunkData.products_filtered ?? 0;
              const filteredLabel = chunkData.products_filtered > 0 ? `, ${chunkData.products_filtered} filtered` : "";
              addJobLog(jobId, "extracting", `Chunk ${chunkIdx + 1}/${totalChunks}: ${chunkData.products_found} products${filteredLabel}${qualityLabel}`);

              // Re-extract pages flagged for re-extraction (low product count vs expected)
              if (chunkData.pages_needing_reextraction?.length > 0 && !chunkData.truncated) {
                reextractedPageCount += chunkData.pages_needing_reextraction.length;
                addJobLog(jobId, "extracting", `Re-extracting ${chunkData.pages_needing_reextraction.length} pages with low product coverage...`);
                for (const reextractPage of chunkData.pages_needing_reextraction) {
                  const singlePages = pages.filter((p) => p.page_number === reextractPage);
                  if (singlePages.length === 0) continue;
                  const reextractRes = await fetch(`/api/catalogs/${catalog_id}/extract-chunk`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      pages: singlePages,
                      schema,
                      category_context: "",
                      chunk_index: chunkIdx,
                      total_chunks: totalChunks,
                      catalog_type: classification.catalog_type,
                      page_classifications: chunkPageClassifications.filter((pc) => pc.page_number === reextractPage),
                    }),
                  });
                  if (reextractRes.ok) {
                    const reData = await reextractRes.json();
                    addJobLog(jobId, "extracting", `  Page ${reextractPage} re-extracted: ${reData.products_found} products`);
                  }
                }
              }

              // P0-1: Handle truncation — split and retry with 1 page each
              if (chunkData.truncated && pageNums.length > 1) {
                truncatedChunkCount++;
                addJobLog(jobId, "extracting", `Chunk ${chunkIdx + 1} was truncated — re-extracting pages individually...`);
                for (const singlePage of pageNums) {
                  const singlePages = pages.filter((p) => p.page_number === singlePage);
                  const singleRes = await fetch(`/api/catalogs/${catalog_id}/extract-chunk`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      pages: singlePages,
                      schema,
                      category_context: "",
                      chunk_index: chunkIdx,
                      total_chunks: totalChunks,
                    }),
                  });
                  if (singleRes.ok) {
                    const singleData = await singleRes.json();
                    addJobLog(jobId, "extracting", `  Page ${singlePage}: ${singleData.products_found} products (re-extracted)`);
                  }
                }
                updateJobChunkStatus(jobId, chunkIdx, "done");
              } else {
                if (chunkData.truncated) truncatedChunkCount++;
                updateJobChunkStatus(jobId, chunkIdx, chunkData.truncated ? "truncated" : "done");
              }

              // Cache extracted text for context
              for (const page of pages) {
                if (page.page_number && !allPageTexts.has(page.page_number)) {
                  const text = pages.find((p) => p.page_number === page.page_number);
                  if (text?.text) allPageTexts.set(page.page_number, text.text);
                }
              }

              break; // Success — exit retry loop
            } else {
              if (attempt < MAX_RETRIES - 1) {
                addJobLog(jobId, "extracting", `Chunk ${chunkIdx + 1} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
                await sleep(RETRY_DELAYS[attempt]);
              } else {
                addJobLog(jobId, "extracting", `Chunk ${chunkIdx + 1}/${totalChunks}: failed after ${MAX_RETRIES} attempts`);
                failedChunkCount++;
                updateJobChunkStatus(jobId, chunkIdx, "failed");
              }
            }
          } catch (err) {
            if (attempt < MAX_RETRIES - 1) {
              addJobLog(jobId, "extracting", `Chunk ${chunkIdx + 1} error (attempt ${attempt + 1}): ${String(err).slice(0, 80)}, retrying...`);
              await sleep(RETRY_DELAYS[attempt]);
            } else {
              addJobLog(jobId, "extracting", `Chunk ${chunkIdx + 1}/${totalChunks}: failed after ${MAX_RETRIES} attempts`);
              failedChunkCount++;
              updateJobChunkStatus(jobId, chunkIdx, "failed");
            }
          }
        }

        completedChunks++;
        updateJob(jobId, {
          progress: 15 + Math.round((completedChunks / totalChunks) * 70),
          progressLabel: `Extracted ${completedChunks} / ${totalChunks} chunks...`,
        });
      }

      // Run chunks with concurrency pool
      const queue = Array.from({ length: totalChunks }, (_, i) => i);
      const workers = Array.from({ length: Math.min(CONCURRENCY, totalChunks) }, async () => {
        while (queue.length > 0) {
          const idx = queue.shift()!;
          await processChunkWithRetry(idx, chunks[idx]);
        }
      });
      await Promise.all(workers);

      // 4. Finalize — send chunk failure/truncation data
      updateJob(jobId, { stage: "finalizing", progressLabel: "Finalizing — building search index...", progress: 88 });
      addJobLog(jobId, "indexing", "Building full-text search index...");

      const finalRes = await fetch(`/api/catalogs/${catalog_id}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_hash: fingerprintData?.content_hash ?? null,
          text_sample: fingerprintData?.text_sample ?? null,
          failed_chunks: failedChunkCount,
          total_chunks: totalChunks,
          truncated_chunks: truncatedChunkCount,
          reextracted_pages: reextractedPageCount,
          filtered_products: filteredProductCount,
          catalog_type: classification.catalog_type,
          pages_skipped: skippedPages.length,
          pages_processed: pagesToProcess.length,
        }),
      });
      if (!finalRes.ok) throw new Error(`Finalize failed: ${await finalRes.text()}`);
      const finalData = await finalRes.json();

      updateJob(jobId, { progress: 100 });

      // P0-6: Show appropriate completion status
      if (finalData.warnings || failedChunkCount > 0 || truncatedChunkCount > 0) {
        const warnings: string[] = [];
        if (failedChunkCount > 0) warnings.push(`${failedChunkCount} chunks failed`);
        if (truncatedChunkCount > 0) warnings.push(`${truncatedChunkCount} chunks had truncated responses`);
        const warnText = `${finalData.inserted} products extracted. Warnings: ${warnings.join(", ")}`;
        addJobLog(jobId, "completed", warnText);
        updateJob(jobId, {
          warningMsg: warnText,
          stage: "done_with_warnings",
          progressLabel: "Processing complete with warnings",
        });
        toast.warning(`${file.name}: Catalog processed with some warnings`);
      } else {
        const report = finalData.extraction_report;
        const details: string[] = [`${finalData.inserted} products extracted`];
        if (report?.pages_skipped > 0) details.push(`${report.pages_skipped} pages skipped`);
        if (report?.reextracted_pages > 0) details.push(`${report.reextracted_pages} pages re-extracted`);
        if (report?.filtered_products > 0) details.push(`${report.filtered_products} low-quality removed`);
        addJobLog(jobId, "completed", `Done! ${details.join(", ")}. ${finalData.indexed} indexed for search.`);
        updateJob(jobId, {
          stage: "done",
          progressLabel: "Processing complete!",
        });
        toast.success(`${file.name}: Catalog processed successfully!`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addJobLog(jobId, "failed", `Error: ${msg}`);
      updateJob(jobId, {
        errorMsg: msg,
        stage: "error",
      });
      toast.error(`${file.name}: Processing failed`);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900">Upload Catalogs</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Upload product catalog PDFs — AI will extract all products automatically. You can upload multiple files at once.
        </p>
      </div>

      {/* Drop Zone — always visible */}
      <div
        ref={dropRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
          isDragging
            ? "border-indigo-400 bg-indigo-50 scale-[1.01]"
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

        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
            <Icon name="upload" className="w-6 h-6 text-slate-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-700">Drop your PDF here</p>
            <p className="text-sm text-slate-400 mt-0.5">or click to browse files</p>
          </div>
          <p className="text-xs text-slate-300">PDF files only — each file processes independently</p>
        </div>
      </div>

      {/* Feature cards — show when no jobs yet */}
      {jobs.length === 0 && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: "search" as const, title: "Smart Deduplication", desc: "Detects if this catalog was already processed" },
            { icon: "sparkle" as const, title: "Parallel Extraction", desc: "Multiple chunks processed concurrently for speed" },
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

      {/* Job Cards */}
      {jobs.length > 0 && (
        <div className="mt-6 space-y-4">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onToggleCollapse={() => toggleJobCollapse(job.id)}
              onRemove={() => removeJob(job.id)}
              onViewCatalog={() => {
                if (job.catalogId) router.push(`/catalog/${job.catalogId}`);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Job Card ─────────────────────────────────────────────────────────────────
function JobCard({
  job,
  onToggleCollapse,
  onRemove,
  onViewCatalog,
}: {
  job: UploadJob;
  onToggleCollapse: () => void;
  onRemove: () => void;
  onViewCatalog: () => void;
}) {
  const isProcessing = ["reading", "schema", "extracting", "finalizing", "fingerprinting"].includes(job.stage);
  const isDone = job.stage === "done" || job.stage === "done_with_warnings";
  const isError = job.stage === "error";

  const statusColor = isDone
    ? "border-emerald-200 bg-emerald-50/50"
    : isError
    ? "border-red-200 bg-red-50/50"
    : job.stage === "done_with_warnings"
    ? "border-amber-200 bg-amber-50/50"
    : "border-slate-200 bg-white";

  return (
    <Card className={`overflow-hidden ${statusColor}`}>
      {/* Header — always visible */}
      <div
        className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none"
        onClick={onToggleCollapse}
      >
        {/* Status icon */}
        <div className="shrink-0">
          {isProcessing && (
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {job.stage === "done" && (
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
              <Icon name="checkCircle" className="w-4 h-4 text-emerald-500" />
            </div>
          )}
          {job.stage === "done_with_warnings" && (
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
              <Icon name="warning" className="w-4 h-4 text-amber-500" />
            </div>
          )}
          {isError && (
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
              <Icon name="warning" className="w-4 h-4 text-red-400" />
            </div>
          )}
          {job.stage === "idle" && (
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
              <Icon name="upload" className="w-4 h-4 text-slate-400" />
            </div>
          )}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{job.fileName}</p>
          <p className="text-xs text-slate-400">
            {(job.fileSize / 1024 / 1024).toFixed(2)} MB
            {isProcessing && ` — ${job.progressLabel}`}
            {job.stage === "done" && " — Complete"}
            {job.stage === "done_with_warnings" && " — Complete with warnings"}
            {isError && " — Failed"}
          </p>
        </div>

        {/* Progress percentage when processing */}
        {isProcessing && (
          <span className="text-sm font-bold text-indigo-600 shrink-0">{job.progress}%</span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {isDone && job.catalogId && (
            <Button onClick={onViewCatalog} size="sm" className="text-xs">
              View Catalog
            </Button>
          )}
          {(isDone || isError) && (
            <button
              onClick={onRemove}
              className="text-xs text-slate-400 hover:text-slate-600 p-1"
              title="Dismiss"
            >
              <Icon name="x" className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Collapse chevron */}
        <Icon
          name="chevronDown"
          className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${job.collapsed ? "" : "rotate-180"}`}
        />
      </div>

      {/* Mini progress bar in header */}
      {isProcessing && (
        <div className="h-1 bg-slate-100">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      {/* Collapsible content */}
      {!job.collapsed && (
        <div>
          {/* Processing view */}
          {isProcessing && (
            <ProcessingView
              stage={job.stage}
              progress={job.progress}
              progressLabel={job.progressLabel}
              log={job.log}
              chunkStatuses={job.chunkStatuses}
            />
          )}

          {/* Done */}
          {job.stage === "done" && (
            <div className="px-5 py-4 border-t border-emerald-100">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="checkCircle" className="w-4 h-4 text-emerald-500" />
                <p className="text-sm font-semibold text-emerald-700">Processing complete!</p>
              </div>
              {job.log.length > 0 && (
                <p className="text-xs text-emerald-600 ml-6">
                  {job.log[job.log.length - 1]?.message}
                </p>
              )}
            </div>
          )}

          {/* Done with warnings */}
          {job.stage === "done_with_warnings" && (
            <div className="px-5 py-4 border-t border-amber-100">
              <div className="flex items-start gap-2">
                <Icon name="warning" className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" strokeWidth={2} />
                <div>
                  <p className="text-sm font-semibold text-amber-700">Processing completed with warnings</p>
                  <p className="text-xs text-amber-600 mt-1">{job.warningMsg}</p>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="px-5 py-4 border-t border-red-100">
              <div className="flex items-start gap-2">
                <Icon name="warning" className="w-4 h-4 text-red-400 shrink-0 mt-0.5" strokeWidth={2} />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-700">Processing failed</p>
                  <p className="text-xs text-red-500 mt-1 break-words">{job.errorMsg}</p>
                </div>
              </div>
            </div>
          )}

          {/* Log for completed/error states */}
          {(isDone || isError) && job.log.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-100 max-h-36 overflow-y-auto space-y-1">
              {[...job.log].reverse().map((entry, i) => (
                <div key={i} className="flex items-start gap-2">
                  <LogDot status={entry.status} />
                  <p className="text-xs text-slate-500 leading-relaxed">{entry.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
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
  chunkStatuses: ("pending" | "running" | "done" | "failed" | "truncated")[];
}) {
  const stages = [
    { key: "fingerprinting", label: "Dedup Check" },
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
                    : s === "truncated"
                    ? "bg-amber-400"
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
          <p className="text-xs text-slate-300 italic">Waiting for logs...</p>
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
    status === "fingerprinting" ? "bg-amber-400 animate-pulse" :
    status === "extracting" ? "bg-blue-400 animate-pulse" :
    status === "inserting" ? "bg-violet-400 animate-pulse" :
    status === "indexing" ? "bg-indigo-400 animate-pulse" :
    "bg-slate-300";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${color}`} />;
}
