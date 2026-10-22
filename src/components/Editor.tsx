/**
 * Science of Gifts - Visual Rich-Text Editorial Editor
 * Powered by Tiptap (ProseMirror engine)
 * Zero Markdown syntax. True visual rich text formatting.
 * Complete separation of editor mechanics and deliberate AI actions.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Superscript from '@tiptap/extension-superscript';
import { storage } from '../services/storage';
import { cleanTrackingParameters, hasTrackingParameters } from '../utils/urlUtils';

const CustomSuperscript = Superscript.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-study-id': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-study-id'),
        renderHTML: (attributes) => {
          if (!attributes['data-study-id']) return {};
          return { 'data-study-id': attributes['data-study-id'] };
        },
      },
      class: {
        default: 'citation-ref text-[11px] font-semibold text-amber-900 select-none cursor-pointer',
        parseHTML: (element) => element.getAttribute('class') || 'citation-ref',
        renderHTML: (attributes) => ({
          class:
            attributes.class ||
            'citation-ref text-[11px] font-semibold text-amber-900 select-none cursor-pointer',
        }),
      },
    };
  },
});
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Quote,
  List,
  ListOrdered,
  Link2,
  Unlink,
  Image as ImageIcon,
  Undo2,
  Redo2,
  RemoveFormatting,
  Sparkles,
  Maximize2,
  Minimize2,
  Type,
  FileText,
  Clock,
  ChevronDown,
  BookOpen,
} from 'lucide-react';

export interface AiActionOption {
  id: string;
  label: string;
  desc?: string;
}

interface EditorProps {
  content: string; // Semantic HTML document
  projectId?: string;
  restoreTrigger?: number | string;
  onChange: (newHtml: string) => void;
  onSelectionChange?: (selectedText: string, range: { start: number; end: number }) => void;
  onExplicitAiAction?: (action: string, selectedText: string, range: { start: number; end: number }) => void;
  onOpenCustomAi?: (selectedText: string, range: { start: number; end: number }) => void;
  editorRef?: React.MutableRefObject<any>;
}

export const Editor: React.FC<EditorProps> = ({
  content,
  projectId,
  restoreTrigger,
  onChange,
  onSelectionChange,
  onExplicitAiAction,
  onOpenCustomAi,
  editorRef,
}) => {
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isAiMenuOpen, setIsAiMenuOpen] = useState(false);
  const [isLinkPromptOpen, setIsLinkPromptOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDisplayText, setLinkDisplayText] = useState('');
  const [activeBlockType, setActiveBlockType] = useState('paragraph');

  // Track project ID and restore triggers via refs to break autosave feedback loops
  const currentProjectIdRef = useRef<string | undefined>(projectId);
  const prevRestoreTriggerRef = useRef<number | string | undefined>(restoreTrigger);

  // Image insertion state
  const [isImagePromptOpen, setIsImagePromptOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageAlt, setImageAlt] = useState('');
  const [imageTitle, setImageTitle] = useState('');

  const aiMenuRef = useRef<HTMLDivElement>(null);
  const linkPopoverRef = useRef<HTMLDivElement>(null);
  const imagePopoverRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4],
        },
      }),
      Underline,
      Image.configure({
        inline: false,
        HTMLAttributes: {
          class: 'rounded-xl max-w-full my-4 border border-[#e5dfd3]',
        },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      CustomSuperscript,
    ],
    content,
    editorProps: {
      attributes: {
        class: 'focus:outline-hidden min-h-[420px] px-2 py-4',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
    },
    onSelectionUpdate: ({ editor }) => {
      // Update block type selector without triggering any popup
      if (editor.isActive('heading', { level: 1 })) {
        setActiveBlockType('h1');
      } else if (editor.isActive('heading', { level: 2 })) {
        setActiveBlockType('h2');
      } else if (editor.isActive('heading', { level: 3 })) {
        setActiveBlockType('h3');
      } else if (editor.isActive('heading', { level: 4 })) {
        setActiveBlockType('h4');
      } else if (editor.isActive('blockquote')) {
        setActiveBlockType('blockquote');
      } else {
        setActiveBlockType('paragraph');
      }

      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, ' ').trim();
      if (onSelectionChange) {
        onSelectionChange(text, { start: from, end: to });
      }
    },
  });

  // Expose editor to parent if needed
  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

  // Only call setContent when switching to a completely different project
  useEffect(() => {
    if (!editor) return;
    if (projectId && projectId !== currentProjectIdRef.current) {
      currentProjectIdRef.current = projectId;
      editor.commands.setContent(content || '', { emitUpdate: false });
    }
  }, [projectId, content, editor]);

  // Handle explicit external restore triggers (e.g. restoring version snapshots or accepting AI diff proposals)
  useEffect(() => {
    if (!editor) return;
    if (restoreTrigger !== undefined && restoreTrigger !== prevRestoreTriggerRef.current) {
      prevRestoreTriggerRef.current = restoreTrigger;
      editor.commands.setContent(content || '', { emitUpdate: false });
    }
  }, [restoreTrigger, content, editor]);

  // Listen for explicit external restore custom events
  useEffect(() => {
    if (!editor) return;
    const handleRestoreEvent = (e: CustomEvent<{ content: string; projectId?: string }>) => {
      if (e.detail?.projectId && projectId && e.detail.projectId !== projectId) {
        return;
      }
      if (typeof e.detail?.content === 'string') {
        editor.commands.setContent(e.detail.content, { emitUpdate: false });
      }
    };

    window.addEventListener('sog:restore-editor-content' as any, handleRestoreEvent as any);
    return () => {
      window.removeEventListener('sog:restore-editor-content' as any, handleRestoreEvent as any);
    };
  }, [editor, projectId]);

  // Close menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setIsAiMenuOpen(false);
      }
      if (linkPopoverRef.current && !linkPopoverRef.current.contains(e.target as Node)) {
        setIsLinkPromptOpen(false);
      }
      if (imagePopoverRef.current && !imagePopoverRef.current.contains(e.target as Node)) {
        setIsImagePromptOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  if (!editor) {
    return (
      <div className="flex-1 min-h-[480px] rounded-xl border border-[#dcd6ca] bg-[#faf9f6] flex items-center justify-center text-xs text-[#8c8477]">
        Loading writing studio canvas...
      </div>
    );
  }

  // Get current selection info for deliberate AI button
  const { from, to } = editor.state.selection;
  const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
  const selectedWordCount = selectedText ? selectedText.split(/\s+/).filter(Boolean).length : 0;

  // Block style change
  const handleBlockChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setActiveBlockType(val);
    switch (val) {
      case 'h1':
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case 'h2':
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case 'h3':
        editor.chain().focus().toggleHeading({ level: 3 }).run();
        break;
      case 'h4':
        editor.chain().focus().toggleHeading({ level: 4 }).run();
        break;
      case 'blockquote':
        editor.chain().focus().toggleBlockquote().run();
        break;
      case 'paragraph':
      default:
        editor.chain().focus().setParagraph().run();
        break;
    }
  };

  // Link handling
  const handleToggleLink = () => {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      setIsLinkPromptOpen(false);
      return;
    }
    const previousUrl = editor.getAttributes('link').href || '';
    const { from, to } = editor.state.selection;
    const currentSelectedText = editor.state.doc.textBetween(from, to, ' ').trim();

    setLinkUrl(previousUrl);
    setLinkDisplayText(currentSelectedText);
    setIsLinkPromptOpen(true);
  };

  const handleSelectLibraryLink = (linkId: string) => {
    const libraryLinks = storage.getInternalLinks().filter((l) => l.active);
    const found = libraryLinks.find((l) => l.id === linkId);
    if (found) {
      setLinkUrl(cleanTrackingParameters(found.url));
      if (!linkDisplayText && found.preferredAnchor) {
        setLinkDisplayText(found.preferredAnchor);
      } else if (!linkDisplayText) {
        setLinkDisplayText(found.title);
      }
    }
  };

  const handleApplyLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUrl.trim()) {
      editor.chain().focus().unsetLink().run();
    } else {
      let url = cleanTrackingParameters(linkUrl.trim());
      if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
        url = `https://${url}`;
      }

      const { from, to } = editor.state.selection;
      const currentSelection = editor.state.doc.textBetween(from, to, ' ').trim();

      if (linkDisplayText.trim() && linkDisplayText.trim() !== currentSelection) {
        editor
          .chain()
          .focus()
          .insertContent(`<a href="${url}" target="_blank" rel="noopener noreferrer">${linkDisplayText.trim()}</a>`)
          .run();
      } else {
        editor.chain().focus().setLink({ href: url }).run();
      }
    }
    setIsLinkPromptOpen(false);
    setLinkUrl('');
    setLinkDisplayText('');
  };

  // AI Actions Trigger
  const handleSelectAiAction = (actionId: string) => {
    setIsAiMenuOpen(false);
    const range = { start: from, end: to };

    if (actionId === 'custom') {
      if (onOpenCustomAi) {
        onOpenCustomAi(selectedText, range);
      }
      return;
    }

    if (onExplicitAiAction) {
      onExplicitAiAction(actionId, selectedText, range);
    }
  };

  const selectionActions: AiActionOption[] = [
    { id: 'rewrite_selection', label: 'Rewrite Selection', desc: 'Fresh phrasing retaining core meaning' },
    { id: 'make_more_concise', label: 'Make More Concise', desc: 'Tighten prose and eliminate redundant words' },
    { id: 'expand_selection', label: 'Expand', desc: 'Deepen tactile observations and craft details' },
    { id: 'improve_flow', label: 'Improve Flow', desc: 'Seamless, natural transitions and rhythm' },
    { id: 'change_tone', label: 'Change Tone', desc: 'Modulate to match active writing controls' },
    { id: 'add_context', label: 'Add Context', desc: 'Infuse relevant provenance or historical notes' },
    { id: 'simplify', label: 'Simplify', desc: 'Clear away convoluted syntax into plain prose' },
    { id: 'custom', label: 'Custom Instruction...', desc: 'Enter specific editorial direction for AI' },
  ];

  const documentActions: AiActionOption[] = [
    { id: 'generate_intro', label: 'Generate Introduction', desc: 'Draft an evocative opening grounded in the brief' },
    { id: 'generate_section', label: 'Generate Section', desc: 'Draft next section from your outline' },
    { id: 'continue_writing', label: 'Continue Writing', desc: 'Continue the line of reasoning naturally' },
    { id: 'review_writing', label: 'Review Writing', desc: 'Editorial critique and proposed improvements' },
    { id: 'improve_flow', label: 'Improve Document Flow', desc: 'Harmonize cadence across paragraphs' },
    { id: 'custom', label: 'Custom Instruction...', desc: 'Freeform prompt for the entire document' },
  ];

  const aiActions = selectedWordCount > 0 ? selectionActions : documentActions;

  // Text statistics
  const plainText = editor.getText();
  const words = plainText.trim() ? plainText.trim().split(/\s+/).filter(Boolean).length : 0;
  const chars = plainText.length;
  const readTimeMinutes = Math.max(1, Math.ceil(words / 200));

  return (
    <div
      className={`flex flex-col bg-[#faf9f6] transition-all ${
        isFocusMode
          ? 'fixed inset-0 z-50 p-4 md:p-12 overflow-y-auto'
          : 'flex-1 min-h-0 min-h-[280px] rounded-xl border border-[#dcd6ca] shadow-xs overflow-hidden'
      }`}
    >
      {/* Visual Rich-Text Toolbar */}
      <div className="px-2 sm:px-4 py-1.5 sm:py-2 bg-[#f5f2ea] border-b border-[#e5dfd3] flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 shrink-0 rounded-t-xl select-none">
        <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto max-w-full py-0.5">
          {/* Undo / Redo */}
          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="p-1.5 text-[#5c5447] hover:text-[#1e232a] disabled:opacity-30 rounded-md hover:bg-[#e8e2d5] transition-colors shrink-0"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="p-1.5 text-[#5c5447] hover:text-[#1e232a] disabled:opacity-30 rounded-md hover:bg-[#e8e2d5] transition-colors shrink-0"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-[#dcd6ca] mx-1" />

          {/* Block Style Selector (Real Block Type) */}
          <select
            value={activeBlockType}
            onChange={handleBlockChange}
            className="text-xs font-semibold py-1 px-2.5 rounded-md border border-[#dcd6ca] bg-white text-[#2d333b] focus:outline-hidden focus:ring-1 focus:ring-amber-500 cursor-pointer shadow-2xs"
          >
            <option value="paragraph">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="h4">Heading 4</option>
            <option value="blockquote">Quote Block</option>
          </select>

          <div className="h-4 w-px bg-[#dcd6ca] mx-1" />

          {/* Text Style Marks */}
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded-md transition-colors ${
              editor.isActive('bold')
                ? 'bg-[#1e232a] text-white shadow-2xs'
                : 'text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5]'
            }`}
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded-md transition-colors ${
              editor.isActive('italic')
                ? 'bg-[#1e232a] text-white shadow-2xs'
                : 'text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5]'
            }`}
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`p-1.5 rounded-md transition-colors ${
              editor.isActive('underline')
                ? 'bg-[#1e232a] text-white shadow-2xs'
                : 'text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5]'
            }`}
            title="Underline (Ctrl+U)"
          >
            <UnderlineIcon className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`p-1.5 rounded-md transition-colors ${
              editor.isActive('strike')
                ? 'bg-[#1e232a] text-white shadow-2xs'
                : 'text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5]'
            }`}
            title="Strikethrough"
          >
            <Strikethrough className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-[#dcd6ca] mx-1" />

          {/* Lists */}
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded-md transition-colors ${
              editor.isActive('bulletList')
                ? 'bg-[#1e232a] text-white shadow-2xs'
                : 'text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5]'
            }`}
            title="Bulleted List"
          >
            <List className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1.5 rounded-md transition-colors ${
              editor.isActive('orderedList')
                ? 'bg-[#1e232a] text-white shadow-2xs'
                : 'text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5]'
            }`}
            title="Numbered List"
          >
            <ListOrdered className="w-4 h-4" />
          </button>

          {/* Link */}
          <div className="relative" ref={linkPopoverRef}>
            <button
              type="button"
              onClick={handleToggleLink}
              className={`p-1.5 rounded-md transition-colors ${
                editor.isActive('link')
                  ? 'bg-blue-100 text-blue-900 border border-blue-200'
                  : 'text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5]'
              }`}
              title={editor.isActive('link') ? 'Remove Link' : 'Add Hyperlink'}
            >
              {editor.isActive('link') ? <Unlink className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
            </button>

            {isLinkPromptOpen && (
              <form
                onSubmit={handleApplyLink}
                className="absolute left-0 mt-1.5 z-50 p-3.5 bg-white border border-[#dcd6ca] rounded-xl shadow-2xl flex flex-col gap-2.5 w-[calc(100vw-36px)] max-w-sm sm:w-96 text-xs animate-in fade-in"
              >
                <div className="flex items-center justify-between pb-1 border-b border-[#f0ece1]">
                  <span className="font-bold text-[#1e232a] flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-blue-700" />
                    <span>Insert Hyperlink</span>
                  </span>
                  {editor.isActive('link') && (
                    <button
                      type="button"
                      onClick={() => {
                        editor.chain().focus().unsetLink().run();
                        setIsLinkPromptOpen(false);
                      }}
                      className="text-[11px] font-semibold text-rose-700 hover:text-rose-900"
                    >
                      Remove Link
                    </button>
                  )}
                </div>

                {/* Library Quick Select */}
                {storage.getInternalLinks().filter((l) => l.active).length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61]">
                      Quick Select from Internal Library
                    </label>
                    <select
                      onChange={(e) => {
                        if (e.target.value) handleSelectLibraryLink(e.target.value);
                      }}
                      defaultValue=""
                      className="w-full text-xs px-2.5 py-1.5 bg-[#faf9f6] border border-[#dcd6ca] rounded-md text-[#1e232a] focus:outline-hidden"
                    >
                      <option value="">Choose an existing article...</option>
                      {storage.getInternalLinks().filter((l) => l.active).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title} ({l.category})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* URL Input */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61]">
                      Destination URL *
                    </label>
                    {hasTrackingParameters(linkUrl) && (
                      <button
                        type="button"
                        onClick={() => setLinkUrl(cleanTrackingParameters(linkUrl))}
                        className="text-[10px] font-semibold text-amber-800 hover:underline"
                      >
                        Clean Tracking
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://www.scienceofgifts.com/..."
                    className="w-full text-xs px-2.5 py-1.5 rounded-md border border-[#dcd6ca] bg-white focus:outline-hidden focus:border-blue-600 font-mono text-[11px]"
                  />
                </div>

                {/* Display Text Input */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61]">
                    Display Anchor Text (Optional)
                  </label>
                  <input
                    type="text"
                    value={linkDisplayText}
                    onChange={(e) => setLinkDisplayText(e.target.value)}
                    placeholder="Anchor text in sentence..."
                    className="w-full text-xs px-2.5 py-1.5 rounded-md border border-[#dcd6ca] bg-white focus:outline-hidden focus:border-blue-600"
                  />
                </div>

                {/* Popover Buttons */}
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#f0ece1]">
                  <button
                    type="button"
                    onClick={() => setIsLinkPromptOpen(false)}
                    className="px-2.5 py-1.5 text-xs text-[#736c61] hover:text-[#1e232a]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 text-xs font-semibold bg-[#1e232a] text-white rounded-md hover:bg-[#2e3743] shadow-2xs"
                  >
                    Apply Link
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Insert Image */}
          <div className="relative" ref={imagePopoverRef}>
            <button
              type="button"
              onClick={() => {
                setIsImagePromptOpen(!isImagePromptOpen);
                setIsLinkPromptOpen(false);
              }}
              className={`p-1.5 rounded-md transition-colors ${
                isImagePromptOpen
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : 'text-[#5c5447] hover:text-[#1e232a] hover:bg-[#e8e2d5]'
              }`}
              title="Insert Image"
            >
              <ImageIcon className="w-4 h-4" />
            </button>

            {isImagePromptOpen && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!imageUrl.trim()) return;
                  editor
                    .chain()
                    .focus()
                    .setImage({
                      src: imageUrl.trim(),
                      alt: imageAlt.trim() || undefined,
                      title: imageTitle.trim() || undefined,
                    })
                    .run();
                  setIsImagePromptOpen(false);
                  setImageUrl('');
                  setImageAlt('');
                  setImageTitle('');
                }}
                className="absolute left-0 mt-1.5 z-50 p-3.5 bg-white border border-[#dcd6ca] rounded-xl shadow-2xl flex flex-col gap-2.5 w-[calc(100vw-36px)] max-w-sm sm:w-96 text-xs animate-in fade-in"
              >
                <div className="flex items-center justify-between pb-1 border-b border-[#f0ece1]">
                  <span className="font-bold text-[#1e232a] flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-amber-800" />
                    <span>Insert Image</span>
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61]">
                    Image URL (Required)
                  </label>
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://..."
                    required
                    className="w-full text-xs px-2.5 py-1.5 rounded-md border border-[#dcd6ca] bg-white focus:outline-hidden focus:border-amber-600 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61]">
                    Alt Text (Accessibility & SEO)
                  </label>
                  <input
                    type="text"
                    value={imageAlt}
                    onChange={(e) => setImageAlt(e.target.value)}
                    placeholder="Descriptive alt text..."
                    className="w-full text-xs px-2.5 py-1.5 rounded-md border border-[#dcd6ca] bg-white focus:outline-hidden focus:border-amber-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61]">
                    Caption / Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={imageTitle}
                    onChange={(e) => setImageTitle(e.target.value)}
                    placeholder="Optional image caption..."
                    className="w-full text-xs px-2.5 py-1.5 rounded-md border border-[#dcd6ca] bg-white focus:outline-hidden focus:border-amber-600"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#f0ece1]">
                  <button
                    type="button"
                    onClick={() => setIsImagePromptOpen(false)}
                    className="px-2.5 py-1.5 text-xs text-[#736c61] hover:text-[#1e232a]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 text-xs font-semibold bg-[#1e232a] text-white rounded-md hover:bg-[#2e3743] shadow-2xs"
                  >
                    Insert Image
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Clear Formatting */}
          <button
            type="button"
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            className="p-1.5 text-[#5c5447] hover:text-[#1e232a] rounded-md hover:bg-[#e8e2d5] transition-colors"
            title="Clear Formatting"
          >
            <RemoveFormatting className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Explicit AI Edit & Focus Mode */}
        <div className="flex items-center gap-2">
          {/* Explicit AI Edit Menu (Activated ONLY on deliberate click) */}
          <div className="relative" ref={aiMenuRef}>
            <button
              type="button"
              onClick={() => setIsAiMenuOpen(!isAiMenuOpen)}
              className="px-2.5 py-1.5 text-xs font-semibold text-[#1e232a] bg-white border border-[#dcd6ca] rounded-lg hover:bg-[#ede8dc] transition-colors inline-flex items-center gap-1.5 shadow-2xs"
              title="Click to choose an AI editing action"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-700" />
              <span>AI Edit</span>
              {selectedWordCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                  {selectedWordCount}w
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-[#736c61]" />
            </button>

            {isAiMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-64 max-w-[calc(100vw-2rem)] bg-white border border-[#dcd6ca] rounded-xl shadow-xl py-1.5 z-50 text-xs animate-in fade-in duration-100">
                <div className="px-3 py-1.5 border-b border-[#f0ede6] text-[11px] text-[#736c61]">
                  {selectedWordCount > 0 ? (
                    <span className="font-medium text-[#2d333b]">
                      Target: Selected text ({selectedWordCount} words)
                    </span>
                  ) : (
                    <span>Target: Full draft</span>
                  )}
                </div>

                <div className="py-1 max-h-80 overflow-y-auto">
                  {aiActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => handleSelectAiAction(action.id)}
                      className="w-full px-3 py-2 text-left hover:bg-[#f6f3eb] flex flex-col transition-colors group"
                    >
                      <span className="font-semibold text-[#1e232a] group-hover:text-amber-900">
                        {action.label}
                      </span>
                      {action.desc && (
                        <span className="text-[10px] text-[#787166]">{action.desc}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-[#dcd6ca] mx-0.5" />

          {/* Focus Mode */}
          <button
            type="button"
            onClick={() => setIsFocusMode(!isFocusMode)}
            className="p-1.5 text-[#5c5447] hover:text-[#1e232a] rounded-md hover:bg-[#e8e2d5] transition-colors inline-flex items-center gap-1 text-xs"
            title={isFocusMode ? 'Exit Distraction-Free' : 'Distraction-Free Mode'}
          >
            {isFocusMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span className="hidden md:inline">{isFocusMode ? 'Exit Focus' : 'Focus'}</span>
          </button>
        </div>
      </div>

      {/* Real Rich-Text Document Body */}
      <div className="flex-1 min-h-0 p-3 sm:p-5 md:p-8 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      {/* Metrics Footer */}
      <div className="px-3 sm:px-5 py-2 bg-[#f5f2ea]/70 border-t border-[#e8e4db] flex items-center justify-between text-xs text-[#736c61] rounded-b-xl">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#4a443b]">
            <Type className="w-3.5 h-3.5" />
            {words} words
          </span>
          <span className="hidden sm:inline-flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            {chars} characters
          </span>
          <span className="hidden md:inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            ~{readTimeMinutes} min read
          </span>
        </div>

        {selectedWordCount > 0 && (
          <span className="text-[#615a50] text-[11px]">
            {selectedWordCount} words highlighted
          </span>
        )}
      </div>
    </div>
  );
};
