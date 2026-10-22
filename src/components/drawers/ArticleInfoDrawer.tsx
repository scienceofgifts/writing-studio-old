/**
 * Science of Gifts - Article Information & Settings Drawer
 * Drawer for managing article metadata: slug, deck/standfirst, category,
 * author details, hero image, SEO fields, tags, sources, and related content.
 */

import React, { useState } from 'react';
import { ArticleMetadata } from '../../types/project';
import { storage } from '../../services/storage';
import { slugify } from '../../services/articleExport';
import {
  Sliders,
  X,
  Sparkles,
  Image as ImageIcon,
  User,
  Search,
  Tag,
  BookOpen,
  Link2,
  Calendar,
  ExternalLink,
  Check,
} from 'lucide-react';

interface ArticleInfoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: ArticleMetadata;
  projectTitle: string;
  onUpdateTitle: (newTitle: string) => void;
  onChange: (updatedMetadata: ArticleMetadata) => void;
}

export const ArticleInfoDrawer: React.FC<ArticleInfoDrawerProps> = ({
  isOpen,
  onClose,
  metadata,
  projectTitle,
  onUpdateTitle,
  onChange,
}) => {
  const [tagInput, setTagInput] = useState('');
  const [sourceInput, setSourceInput] = useState('');
  const [relatedTitleInput, setRelatedTitleInput] = useState('');
  const [relatedUrlInput, setRelatedUrlInput] = useState('');

  if (!isOpen) return null;

  const availableCategories = storage.getLinkCategories();

  const handleUpdate = <K extends keyof ArticleMetadata>(field: K, value: ArticleMetadata[K]) => {
    onChange({
      ...metadata,
      [field]: value,
    });
  };

  const handleSlugify = () => {
    const generated = slugify(projectTitle);
    handleUpdate('slug', generated);
  };

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const val = tagInput.trim();
    if (val && !(metadata.tags || []).includes(val)) {
      handleUpdate('tags', [...(metadata.tags || []), val]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tToRemove: string) => {
    handleUpdate('tags', (metadata.tags || []).filter((t) => t !== tToRemove));
  };

  const handleAddSource = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const val = sourceInput.trim();
    if (val && !(metadata.sources || []).includes(val)) {
      handleUpdate('sources', [...(metadata.sources || []), val]);
      setSourceInput('');
    }
  };

  const handleRemoveSource = (sToRemove: string) => {
    handleUpdate('sources', (metadata.sources || []).filter((s) => s !== sToRemove));
  };

  const handleAddRelated = (e: React.FormEvent) => {
    e.preventDefault();
    if (relatedTitleInput.trim() && relatedUrlInput.trim()) {
      handleUpdate('relatedContent', [
        ...(metadata.relatedContent || []),
        { title: relatedTitleInput.trim(), url: relatedUrlInput.trim() },
      ]);
      setRelatedTitleInput('');
      setRelatedUrlInput('');
    }
  };

  const handleRemoveRelated = (urlToRemove: string) => {
    handleUpdate(
      'relatedContent',
      (metadata.relatedContent || []).filter((r) => r.url !== urlToRemove)
    );
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-[#faf9f6] border-l border-[#dcd6ca] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-5 border-b border-[#e5dfd3] bg-[#f5f2ea] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-900">
            <Sliders className="w-4 h-4 text-amber-800" />
          </div>
          <div>
            <h3 className="font-editorial text-lg font-semibold text-[#1e232a]">
              Article Details & Metadata
            </h3>
            <p className="text-xs text-[#736c61]">
              CMS categorization, author, hero image, and SEO configuration
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-[#736c61] hover:text-[#2d333b] rounded-md hover:bg-[#e8e2d5] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
        {/* SECTION 1: CORE PUBLICATION FIELDS */}
        <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c5447] block border-b border-[#f0ece3] pb-2">
            Publication Overview
          </span>

          {/* Title */}
          <div>
            <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
              Article Headline / Title
            </label>
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => onUpdateTitle(e.target.value)}
              placeholder="e.g. The Quiet Longevity of Mechanical Field Watches"
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600 font-editorial text-sm font-semibold"
            />
          </div>

          {/* Slug */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-[#5c5447]">
                URL Slug / Handle
              </label>
              <button
                type="button"
                onClick={handleSlugify}
                className="text-[10px] text-amber-800 hover:text-amber-950 font-semibold inline-flex items-center gap-0.5"
              >
                <Sparkles className="w-2.5 h-2.5" />
                <span>Generate from Title</span>
              </button>
            </div>
            <input
              type="text"
              value={metadata.slug || ''}
              onChange={(e) => handleUpdate('slug', e.target.value)}
              placeholder="mechanical-field-watches-guide"
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600 font-mono text-[11px]"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
              Publication Category
            </label>
            <select
              value={metadata.category || 'Product & Craft Advice'}
              onChange={(e) => handleUpdate('category', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden"
            >
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="General">General</option>
            </select>
          </div>

          {/* Standfirst / Deck */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-[#5c5447]">
                Standfirst / Deck
              </label>
              <span className="text-[10px] text-[#8c8477]">
                {(metadata.standfirst || '').length} chars
              </span>
            </div>
            <textarea
              rows={3}
              value={metadata.standfirst || ''}
              onChange={(e) => handleUpdate('standfirst', e.target.value)}
              placeholder="A 1-2 sentence curatorial thesis establishing the premise for the article..."
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600 resize-none leading-relaxed"
            />
          </div>
        </div>

        {/* SECTION 2: AUTHOR INFORMATION */}
        <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3.5">
          <div className="flex items-center gap-1.5 border-b border-[#f0ece3] pb-2">
            <User className="w-3.5 h-3.5 text-amber-800" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c5447]">
              Author Information
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
                Author Name
              </label>
              <input
                type="text"
                value={metadata.author?.name || ''}
                onChange={(e) =>
                  handleUpdate('author', {
                    ...metadata.author,
                    name: e.target.value,
                  })
                }
                placeholder="e.g. Julian Vance"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
                Role / Title
              </label>
              <input
                type="text"
                value={metadata.author?.role || ''}
                onChange={(e) =>
                  handleUpdate('author', {
                    ...metadata.author,
                    name: metadata.author?.name || 'Science of Gifts Editorial',
                    role: e.target.value,
                  })
                }
                placeholder="e.g. Senior Horology Editor"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
              Author Bio Note
            </label>
            <input
              type="text"
              value={metadata.author?.bio || ''}
              onChange={(e) =>
                handleUpdate('author', {
                  ...metadata.author,
                  name: metadata.author?.name || 'Science of Gifts Editorial',
                  bio: e.target.value,
                })
              }
              placeholder="e.g. Writes on material permanence, analog engineering, and heirloom craft."
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
            />
          </div>
        </div>

        {/* SECTION 3: HERO / FEATURED IMAGE */}
        <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3.5">
          <div className="flex items-center gap-1.5 border-b border-[#f0ece3] pb-2">
            <ImageIcon className="w-3.5 h-3.5 text-amber-800" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c5447]">
              Hero / Featured Image
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
              Image URL
            </label>
            <input
              type="text"
              value={metadata.heroImage?.url || ''}
              onChange={(e) =>
                handleUpdate('heroImage', {
                  altText: metadata.heroImage?.altText || projectTitle,
                  ...metadata.heroImage,
                  url: e.target.value,
                })
              }
              placeholder="https://images.unsplash.com/..."
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600 font-mono text-[11px]"
            />
          </div>

          {metadata.heroImage?.url && (
            <div className="rounded-lg overflow-hidden border border-[#dcd6ca] bg-[#f5f2ea] aspect-16/9 relative max-h-36 flex items-center justify-center">
              <img
                src={metadata.heroImage.url}
                alt={metadata.heroImage.altText || 'Hero preview'}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
              Alt Text (Required for CMS & Accessibility)
            </label>
            <input
              type="text"
              value={metadata.heroImage?.altText || ''}
              onChange={(e) =>
                handleUpdate('heroImage', {
                  url: metadata.heroImage?.url || '',
                  ...metadata.heroImage,
                  altText: e.target.value,
                })
              }
              placeholder="Descriptive explanation of the visual for screen readers..."
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
                Caption
              </label>
              <input
                type="text"
                value={metadata.heroImage?.caption || ''}
                onChange={(e) =>
                  handleUpdate('heroImage', {
                    url: metadata.heroImage?.url || '',
                    altText: metadata.heroImage?.altText || projectTitle,
                    ...metadata.heroImage,
                    caption: e.target.value,
                  })
                }
                placeholder="Optional editorial caption..."
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
                Credit / Provenance
              </label>
              <input
                type="text"
                value={metadata.heroImage?.credit || ''}
                onChange={(e) =>
                  handleUpdate('heroImage', {
                    url: metadata.heroImage?.url || '',
                    altText: metadata.heroImage?.altText || projectTitle,
                    ...metadata.heroImage,
                    credit: e.target.value,
                  })
                }
                placeholder="e.g. Science of Gifts Archive"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
            </div>
          </div>
        </div>

        {/* SECTION 4: SEO FIELDS */}
        <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3.5">
          <div className="flex items-center gap-1.5 border-b border-[#f0ece3] pb-2">
            <Search className="w-3.5 h-3.5 text-amber-800" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c5447]">
              Search Engine Optimization (SEO)
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-[#5c5447]">
                SEO Title Tag
              </label>
              <span
                className={`text-[10px] ${
                  (metadata.seoTitle || '').length > 60
                    ? 'text-amber-800 font-bold'
                    : 'text-[#8c8477]'
                }`}
              >
                {(metadata.seoTitle || '').length} / 60 chars
              </span>
            </div>
            <input
              type="text"
              value={metadata.seoTitle || ''}
              onChange={(e) => handleUpdate('seoTitle', e.target.value)}
              placeholder="e.g. Why a Mechanical Field Watch Is the Ultimate Thoughtful Gift"
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-[#5c5447]">
                Meta Description
              </label>
              <span
                className={`text-[10px] ${
                  (metadata.metaDescription || '').length > 160
                    ? 'text-amber-800 font-bold'
                    : 'text-[#8c8477]'
                }`}
              >
                {(metadata.metaDescription || '').length} / 160 chars
              </span>
            </div>
            <textarea
              rows={2}
              value={metadata.metaDescription || ''}
              onChange={(e) => handleUpdate('metaDescription', e.target.value)}
              placeholder="An unhurried editorial examination of field watches, tool aesthetics, and permanence..."
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600 resize-none leading-relaxed"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
                Primary Target Keyword
              </label>
              <input
                type="text"
                value={metadata.targetKeyword || ''}
                onChange={(e) => handleUpdate('targetKeyword', e.target.value)}
                placeholder="e.g. mechanical field watch gift"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
                Search Intent
              </label>
              <input
                type="text"
                value={metadata.searchIntent || ''}
                onChange={(e) => handleUpdate('searchIntent', e.target.value)}
                placeholder="e.g. Discerning advice on horological gifts"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
            </div>
          </div>
        </div>

        {/* SECTION 5: TAGS, SOURCES & RELATED CONTENT */}
        <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3.5">
          <div className="flex items-center gap-1.5 border-b border-[#f0ece3] pb-2">
            <Tag className="w-3.5 h-3.5 text-amber-800" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c5447]">
              Taxonomy, Sources & Related Articles
            </span>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
              Editorial Tags
            </label>
            <div className="flex gap-1.5 mb-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="Add tag and press Enter..."
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 bg-[#e8e2d5] hover:bg-[#ded7c8] text-[#2b251d] font-semibold rounded-lg text-xs"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(metadata.tags || []).map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f5f2ea] border border-[#dcd6ca] text-[11px] text-[#4a443b]"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(t)}
                    className="text-[#8c8477] hover:text-rose-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Sources */}
          <div className="pt-2 border-t border-[#f0ece3]">
            <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
              Sources & Historical Citations
            </label>
            <div className="flex gap-1.5 mb-2">
              <input
                type="text"
                value={sourceInput}
                onChange={(e) => setSourceInput(e.target.value)}
                onKeyDown={handleAddSource}
                placeholder="e.g. British MOD Specification Def-Stan 66-4"
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
              <button
                type="button"
                onClick={handleAddSource}
                className="px-3 py-1.5 bg-[#e8e2d5] hover:bg-[#ded7c8] text-[#2b251d] font-semibold rounded-lg text-xs"
              >
                Add
              </button>
            </div>
            <ul className="space-y-1">
              {(metadata.sources || []).map((s, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between text-[11px] text-[#4a443b] bg-[#faf9f6] p-1.5 rounded border border-[#e5dfd3]"
                >
                  <span className="truncate pr-2">{s}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSource(s)}
                    className="text-[#8c8477] hover:text-rose-700 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Related Content */}
          <div className="pt-2 border-t border-[#f0ece3]">
            <label className="block text-[11px] font-semibold text-[#5c5447] mb-1">
              Related Articles for Readers
            </label>
            <div className="space-y-1.5 mb-2">
              <input
                type="text"
                value={relatedTitleInput}
                onChange={(e) => setRelatedTitleInput(e.target.value)}
                placeholder="Article Title (e.g. The Tactile Permanence of Hand-Wound Watches)"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600"
              />
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={relatedUrlInput}
                  onChange={(e) => setRelatedUrlInput(e.target.value)}
                  placeholder="https://www.scienceofgifts.com/..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600 font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={handleAddRelated}
                  className="px-3 py-1.5 bg-[#e8e2d5] hover:bg-[#ded7c8] text-[#2b251d] font-semibold rounded-lg text-xs"
                >
                  Add Link
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              {(metadata.relatedContent || []).map((r, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded-lg bg-[#faf9f6] border border-[#e5dfd3] text-[11px]"
                >
                  <div className="min-w-0 pr-2">
                    <strong className="block truncate text-[#1e232a]">{r.title}</strong>
                    <span className="text-[10px] text-[#736c61] truncate block">{r.url}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveRelated(r.url)}
                    className="text-[#8c8477] hover:text-rose-700 shrink-0 p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
