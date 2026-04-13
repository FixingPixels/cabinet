"use client";

import { useState } from "react";
import { Copy, Download, FileCode, FileDown, ArrowRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/stores/editor-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { VersionHistory } from "@/components/editor/version-history";
import { HeaderActions } from "@/components/layout/header-actions";

export function Header() {
  const { frontmatter, content, currentPath } = useEditorStore();
  const { open, addEditorSession } = useAIPanelStore();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!prompt.trim() || !currentPath || submitting) return;
    const message = prompt.trim();
    setPrompt("");
    setSubmitting(true);
    open();
    try {
      const response = await fetch("/api/agents/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "editor",
          pagePath: currentPath,
          userMessage: message,
          mentionedPaths: [],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const conversation = data.conversation as { id: string; title: string };
        addEditorSession({
          id: conversation.id,
          sessionId: conversation.id,
          pagePath: currentPath,
          userMessage: message,
          prompt: conversation.title,
          timestamp: Date.now(),
          status: "running",
          reconnect: true,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyMarkdown = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
  };

  const handleCopyHTML = async () => {
    if (!content) return;
    const res = await fetch(`/api/pages/${currentPath}`);
    if (res.ok) {
      const data = await res.json();
      const { markdownToHtml } = await import("@/lib/markdown/to-html");
      const html = await markdownToHtml(data.content);
      await navigator.clipboard.writeText(html);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!content || !frontmatter) return;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${frontmatter.title || "page"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header
      className="flex items-center justify-between border-b border-border px-4 py-2 bg-background/80 backdrop-blur-sm transition-[padding] duration-200"
      style={{ paddingLeft: `calc(1rem + var(--sidebar-toggle-offset, 0px))` }}
    >
      {/* Left: page title */}
      <div className="flex items-center gap-2 min-w-0 w-40 shrink-0">
        <h1 className="text-[13px] font-medium text-foreground truncate tracking-[-0.01em]">
          {frontmatter?.title || "Cabinet"}
        </h1>
      </div>

      {/* Center: AI edit prompt bubble */}
      {currentPath && (
        <div className="flex-1 flex justify-center px-4">
          <div className="flex items-center w-full max-w-sm rounded-full border border-border/60 bg-muted/40 px-3 py-1 gap-2 focus-within:border-border focus-within:bg-muted/70 transition-colors">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="How to edit this page?"
              className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/50 outline-none min-w-0"
            />
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || submitting}
              className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-30 transition-colors cursor-pointer"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Right: actions */}
      <div className="flex items-center gap-1 w-40 justify-end shrink-0">
        {currentPath && (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer">
              <Download className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyMarkdown}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyHTML}>
                <FileCode className="h-4 w-4 mr-2" />
                Copy as HTML
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadMarkdown}>
                <Download className="h-4 w-4 mr-2" />
                Download .md
              </DropdownMenuItem>
              <DropdownMenuItem onClick={async () => {
                const editorEl = document.querySelector(".tiptap");
                if (!editorEl) return;
                const { toPng } = await import("html-to-image");
                const { jsPDF } = await import("jspdf");
                const imgData = await toPng(editorEl as HTMLElement, {
                  backgroundColor: "#ffffff",
                  pixelRatio: 2,
                });
                const img = new Image();
                img.src = imgData;
                await new Promise((resolve) => { img.onload = resolve; });
                const pdf = new jsPDF("p", "mm", "a4");
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = (img.height * pdfWidth) / img.width;
                pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
                pdf.save(`${frontmatter?.title || "page"}.pdf`);
              }}>
                <FileDown className="h-4 w-4 mr-2" />
                Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {currentPath && <VersionHistory />}

        <HeaderActions />
      </div>
    </header>
  );
}
