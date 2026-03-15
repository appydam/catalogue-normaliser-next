"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

interface FingerprintMatch {
  master_catalog_id: string;
  confidence: number;
  match_type: "exact" | "content" | "version_update" | "similar";
  match_details: string;
  catalog_name: string;
  company_name: string;
  total_products: number;
  version: number;
  processing_status: string;
}

import { classifyPage, classifyCatalog, getSkippablePages, getExtractablePages } from "@/lib/catalog-classifier";
import type { CatalogType, PageClassification, CatalogClassification } from "@/lib/catalog-classifier";

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
        body: JSON.stringify({ key: s3Key, image_base64: base64, content_type: "image/png" }),
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
  const [warningMsg, setWarningMsg] = useState<string>("");
  const [chunkStatuses, setChunkStatuses] = useState<("pending" | "running" | "done" | "failed" | "truncated")[]>([]);

  // Classification state
  const [catalogClassification, setCatalogClassification] = useState<CatalogClassification | null>(null);

  // Fingerprint state
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [bestMatch, setBestMatch] = useState<FingerprintMatch | null>(null);
  const [fingerprintData, setFingerprintData] = useState<{
    file_hash: string;
    content_hash: string;
    text_sample: string;
    page_count: number;
    file_size: number;
  } | null>(null);

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

  // ── Fingerprint Check ───────────────────────────────────────────────────────
  async function checkFingerprint(): Promise<boolean> {
    if (!file) return false;

    setStage("fingerprinting");
    setLog([]);
    setProgress(0);
    setErrorMsg("");
    setWarningMsg("");
    addLog("fingerprinting", "Computing PDF fingerprint...");
    setProgressLabel("Checking for duplicates...");

    try {
      const fileHash = await computeFileHash(file);
      setProgress(2);

      const pdfjs = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const pageCount = pdfDoc.numPages;

      const pagesToSample = Math.min(3, pageCount);
      const texts: string[] = [];
      for (let i = 1; i <= pagesToSample; i++) {
        texts.push(await extractPageText(pdfDoc, i));
      }

      const contentHash = await computeContentHash(texts);
      const textSample = texts.join(" ").slice(0, 2000);

      const fp = {
        file_hash: fileHash,
        content_hash: contentHash,
        text_sample: textSample,
        page_count: pageCount,
        file_size: file.size,
      };
      setFingerprintData(fp);
      setProgress(4);

      addLog("fingerprinting", "Checking for existing catalogs...");

      const res = await fetch("/api/fingerprint/check", {
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

      if (!res.ok) {
        addLog("fingerprinting", "Fingerprint check unavailable, proceeding with processing...");
        return false;
      }

      const { best_match } = await res.json();

      if (best_match && best_match.confidence >= MATCH_THRESHOLD && best_match.processing_status === "completed") {
        setBestMatch(best_match);
        setMatchDialogOpen(true);
        setStage("idle");
        return true;
      }

      addLog("fingerprinting", "No existing match found — proceeding with new processing.");
      return false;
    } catch {
      addLog("fingerprinting", "Fingerprint check failed, proceeding...");
      return false;
    }
  }

  // ── Handle Match Dialog Actions ─────────────────────────────────────────────
  async function handleReuse() {
    if (!bestMatch) return;
    setMatchDialogOpen(false);

    try {
      const res = await fetch("/api/catalogs/reuse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master_catalog_id: bestMatch.master_catalog_id }),
      });

      if (res.ok) {
        toast.success("Catalog already processed! Redirecting...");
        router.push(`/catalog/${bestMatch.master_catalog_id}`);
      } else {
        toast.error("Failed to reuse catalog. Processing from scratch...");
        startProcessing(false);
      }
    } catch {
      toast.error("Error. Processing from scratch...");
      startProcessing(false);
    }
  }

  function handleProcessAsNewVersion() {
    setMatchDialogOpen(false);
    startProcessing(false, {
      parent_catalog_id: bestMatch?.master_catalog_id,
      version: (bestMatch?.version ?? 0) + 1,
    });
  }

  function handleProcessFromScratch() {
    setMatchDialogOpen(false);
    startProcessing(false);
  }

  // ── CTA Click Handler ─────────────────────────────────────────────────────
  async function handleStartClick() {
    const matchFound = await checkFingerprint();
    if (!matchFound) {
      startProcessing(false);
    }
  }

  // ── Main Pipeline ────────────────────────────────────────────────────────────
  async function startProcessing(
    _skipFingerprint = false,
    versionInfo?: { parent_catalog_id?: string; version?: number }
  ) {
    if (!file) return;
    abortRef.current = false;
    setStage("reading");
    setLog((prev) => prev.filter((l) => l.status === "fingerprinting"));
    setProgress(5);
    setErrorMsg("");
    setWarningMsg("");
    setCatalogId(null);
    setChunkStatuses([]);

    try {
      // 1. Load PDF in browser
      addLog("reading", `Loading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);
      setProgressLabel("Loading PDF...");

      const pdfjs = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdfDoc.numPages;

      addLog("reading", `PDF loaded: ${totalPages} pages`);
      setProgress(5);

      // 2. Render sample pages for schema discovery
      setStage("schema");
      setProgressLabel("Rendering & uploading sample pages...");
      addLog("schema", "Rendering sample pages for schema discovery...");

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
      setCatalogClassification(classification);
      const pagesPerChunk = classification.pages_per_chunk;

      addLog("schema", `Catalog type: ${classification.catalog_type} (${Math.round(classification.confidence * 100)}% confidence)`);
      if (pagesPerChunk === 1) {
        addLog("schema", `Dense catalog detected — using 1 page per chunk for accuracy`);
      } else if (pagesPerChunk === 3) {
        addLog("schema", `Light image catalog — using 3 pages per chunk for speed`);
      }

      setProgress(10);
      addLog("schema", `Sending ${samplePages.length} sample pages to Claude for schema discovery...`);

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

      addLog("schema", `Schema discovered: ${schema.columns.length} columns for "${schema.company_name}"`);

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
      if (versionInfo?.parent_catalog_id) {
        catalogPayload.parent_catalog_id = versionInfo.parent_catalog_id;
        catalogPayload.version = versionInfo.version;
      }

      const catalogRes = await fetch("/api/catalogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(catalogPayload),
      });
      if (!catalogRes.ok) throw new Error(`Failed to create catalog: ${await catalogRes.text()}`);
      const { catalog_id } = await catalogRes.json();
      setCatalogId(catalog_id);
      setProgress(15);

      // 3. Build page list with intelligent page classification
      setStage("extracting");

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
        addLog("extracting", `Skipping ${skippedPages.length} non-content pages: ${skippedDetail}`);
      }

      // Build chunks from processable pages
      const chunks: number[][] = [];
      for (let i = 0; i < pagesToProcess.length; i += pagesPerChunk) {
        chunks.push(pagesToProcess.slice(i, i + pagesPerChunk));
      }

      const totalChunks = chunks.length;
      addLog("extracting", `Extracting ${pagesToProcess.length} pages in ${totalChunks} chunks (${CONCURRENCY} concurrent)...`);

      setChunkStatuses(Array(totalChunks).fill("pending"));

      let completedChunks = 0;
      let failedChunkCount = 0;
      let truncatedChunkCount = 0;
      let reextractedPageCount = 0;
      let filteredProductCount = 0;

      // P0-2: Process chunk with retry and exponential backoff
      async function processChunkWithRetry(chunkIdx: number, pageNums: number[]) {
        if (abortRef.current) return;

        setChunkStatuses((prev) => {
          const next = [...prev];
          next[chunkIdx] = "running";
          return next;
        });

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            // Render pages
            const pages: { page_number: number; image_url?: string; image_base64?: string; text: string }[] = [];
            for (const pageNum of pageNums) {
              const base64 = await renderPageToBase64(pdfDoc, pageNum);
              const text = await extractPageText(pdfDoc, pageNum);
              const s3Key = `catalogs/${catalog_id}/pages/page-${pageNum}.png`;
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
              addLog("extracting", `Chunk ${chunkIdx + 1}/${totalChunks}: ${chunkData.products_found} products${filteredLabel}${qualityLabel}`);

              // Re-extract pages flagged for re-extraction (low product count vs expected)
              if (chunkData.pages_needing_reextraction?.length > 0 && !chunkData.truncated) {
                reextractedPageCount += chunkData.pages_needing_reextraction.length;
                addLog("extracting", `Re-extracting ${chunkData.pages_needing_reextraction.length} pages with low product coverage...`);
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
                    addLog("extracting", `  Page ${reextractPage} re-extracted: ${reData.products_found} products`);
                  }
                }
              }

              // P0-1: Handle truncation — split and retry with 1 page each
              if (chunkData.truncated && pageNums.length > 1) {
                truncatedChunkCount++;
                addLog("extracting", `Chunk ${chunkIdx + 1} was truncated — re-extracting pages individually...`);
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
                    addLog("extracting", `  Page ${singlePage}: ${singleData.products_found} products (re-extracted)`);
                  }
                }
                setChunkStatuses((prev) => {
                  const next = [...prev];
                  next[chunkIdx] = "done";
                  return next;
                });
              } else {
                if (chunkData.truncated) truncatedChunkCount++;
                setChunkStatuses((prev) => {
                  const next = [...prev];
                  next[chunkIdx] = chunkData.truncated ? "truncated" : "done";
                  return next;
                });
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
                addLog("extracting", `Chunk ${chunkIdx + 1} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
                await sleep(RETRY_DELAYS[attempt]);
              } else {
                addLog("extracting", `Chunk ${chunkIdx + 1}/${totalChunks}: failed after ${MAX_RETRIES} attempts`);
                failedChunkCount++;
                setChunkStatuses((prev) => {
                  const next = [...prev];
                  next[chunkIdx] = "failed";
                  return next;
                });
              }
            }
          } catch (err) {
            if (attempt < MAX_RETRIES - 1) {
              addLog("extracting", `Chunk ${chunkIdx + 1} error (attempt ${attempt + 1}): ${String(err).slice(0, 80)}, retrying...`);
              await sleep(RETRY_DELAYS[attempt]);
            } else {
              addLog("extracting", `Chunk ${chunkIdx + 1}/${totalChunks}: failed after ${MAX_RETRIES} attempts`);
              failedChunkCount++;
              setChunkStatuses((prev) => {
                const next = [...prev];
                next[chunkIdx] = "failed";
                return next;
              });
            }
          }
        }

        completedChunks++;
        setProgress(15 + Math.round((completedChunks / totalChunks) * 70));
        setProgressLabel(`Extracted ${completedChunks} / ${totalChunks} chunks...`);
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
      setStage("finalizing");
      setProgressLabel("Finalizing — building search index...");
      addLog("indexing", "Building full-text search index...");
      setProgress(88);

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

      setProgress(100);

      // P0-6: Show appropriate completion status
      if (finalData.warnings || failedChunkCount > 0 || truncatedChunkCount > 0) {
        const warnings: string[] = [];
        if (failedChunkCount > 0) warnings.push(`${failedChunkCount} chunks failed`);
        if (truncatedChunkCount > 0) warnings.push(`${truncatedChunkCount} chunks had truncated responses`);
        const warnText = `${finalData.inserted} products extracted. Warnings: ${warnings.join(", ")}`;
        setWarningMsg(warnText);
        addLog("completed", warnText);
        setStage("done_with_warnings");
        setProgressLabel("Processing complete with warnings");
        toast.warning("Catalog processed with some warnings");
      } else {
        const report = finalData.extraction_report;
        const details: string[] = [`${finalData.inserted} products extracted`];
        if (report?.pages_skipped > 0) details.push(`${report.pages_skipped} pages skipped`);
        if (report?.reextracted_pages > 0) details.push(`${report.reextracted_pages} pages re-extracted`);
        if (report?.filtered_products > 0) details.push(`${report.filtered_products} low-quality removed`);
        addLog("completed", `Done! ${details.join(", ")}. ${finalData.indexed} indexed for search.`);
        setStage("done");
        setProgressLabel("Processing complete!");
        toast.success("Catalog processed successfully!");
      }

      setTimeout(() => router.push(`/catalog/${catalog_id}`), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStage("error");
      addLog("failed", `Error: ${msg}`);
      toast.error("Processing failed");
    }
  }

  const isProcessing = ["reading", "schema", "extracting", "finalizing", "fingerprinting"].includes(stage);

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

      {/* CTA */}
      {stage === "idle" && (
        <div className="mt-6">
          <Button onClick={handleStartClick} disabled={!file} className="w-full py-3" size="lg">
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
          <p className="text-sm text-emerald-600 mt-1">Redirecting to catalog view...</p>
        </Card>
      )}

      {/* Done with warnings */}
      {stage === "done_with_warnings" && (
        <Card className="p-6 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <Icon name="warning" className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" strokeWidth={2} />
            <div className="flex-1">
              <p className="font-semibold text-amber-700 text-sm">Processing completed with warnings</p>
              <p className="text-xs text-amber-600 mt-1">{warningMsg}</p>
              <p className="text-xs text-amber-500 mt-2">Redirecting to catalog view...</p>
            </div>
          </div>
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
            onClick={() => { setStage("idle"); setLog([]); setProgress(0); setChunkStatuses([]); setWarningMsg(""); }}
            variant="destructive"
            className="mt-4 w-full"
          >
            Try Again
          </Button>
        </Card>
      )}

      {/* ── Match Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Catalog Already Processed</DialogTitle>
          <DialogDescription>
            This PDF matches an existing catalog in the system.
          </DialogDescription>

          {bestMatch && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Match</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    bestMatch.confidence >= 95
                      ? "bg-emerald-100 text-emerald-700"
                      : bestMatch.confidence >= 75
                      ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700"
                  }`}>
                    {bestMatch.confidence}% match
                  </span>
                </div>

                <div>
                  <p className="font-semibold text-slate-800">{bestMatch.catalog_name}</p>
                  <p className="text-sm text-slate-500">{bestMatch.company_name}</p>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>{bestMatch.total_products} products</span>
                  <span>Version {bestMatch.version}</span>
                </div>

                <p className="text-xs text-slate-400 italic">{bestMatch.match_details}</p>
              </div>

              <div className="space-y-2">
                {bestMatch.confidence >= 90 && (
                  <Button onClick={handleReuse} className="w-full" size="lg">
                    Use Existing Catalog
                  </Button>
                )}

                {bestMatch.match_type === "version_update" || bestMatch.match_type === "similar" ? (
                  <Button
                    onClick={handleProcessAsNewVersion}
                    variant={bestMatch.confidence >= 90 ? "secondary" : "primary"}
                    className="w-full"
                  >
                    Process as New Version (v{(bestMatch.version ?? 0) + 1})
                  </Button>
                ) : null}

                <Button
                  onClick={handleProcessFromScratch}
                  variant="ghost"
                  className="w-full text-slate-500"
                >
                  Process from Scratch
                </Button>
              </div>

              <p className="text-xs text-center text-slate-400">
                Reusing saves processing time and AI tokens.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
