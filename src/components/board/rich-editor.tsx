"use client";

import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      protocols: ["http", "https", "mailto"],
      isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    },
  }),
];

/** Editor de texto enriquecido. Produce JSON (no HTML) que el servidor valida contra una lista blanca. */
export function RichEditor({
  value,
  editable,
  onChange,
  placeholder = "Agregá una descripción…",
}: {
  value: unknown;
  editable: boolean;
  onChange?: (json: JSONContent) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions,
    content: (value as JSONContent) ?? "",
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "prose-rich", "aria-label": "Descripción", "data-placeholder": placeholder },
    },
    onUpdate: ({ editor }) => onChange?.(editor.getJSON()),
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return <div className="min-h-24 rounded-xl bg-muted" />;

  const btn = (active: boolean) => cn("rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground", active && "bg-muted text-foreground");

  return (
    <div className={cn("rounded-xl", editable && "border border-border focus-within:border-primary")}>
      {editable && (
        <div className="flex flex-wrap gap-0.5 border-b border-border p-1" role="toolbar" aria-label="Formato">
          <button type="button" aria-label="Negrita" className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Cursiva" className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Tachado" className={btn(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Título" className={btn(editor.isActive("heading"))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Lista" className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Lista numerada" className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Cita" className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Código" className={btn(editor.isActive("code"))} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Enlace"
            className={btn(editor.isActive("link"))}
            onClick={() => {
              const prev = editor.getAttributes("link").href as string | undefined;
              const url = window.prompt("URL del enlace (https://…)", prev ?? "https://");
              if (url === null) return;
              if (url === "") editor.chain().focus().unsetLink().run();
              else if (/^(https?:\/\/|mailto:)/i.test(url)) editor.chain().focus().setLink({ href: url }).run();
            }}
          >
            <Link2 className="h-4 w-4" />
          </button>
        </div>
      )}
      <EditorContent editor={editor} className={cn(editable && "px-3 py-2")} />
    </div>
  );
}
