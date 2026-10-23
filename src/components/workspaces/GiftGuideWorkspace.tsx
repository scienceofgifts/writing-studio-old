/**
 * Science of Gifts - Specialized Gift Guide Studio (Phase 5)
 * Seamlessly integrates guide information, structured product data, editorial context,
 * outline, repetition control, and rich-text WYSIWYG writing.
 */

import React, { useState, useMemo } from 'react';
import {
  WritingProject,
  DiffProposal,
  ActivePanel,
  ProjectType,
} from '../../types/project';
import {
  GiftGuideMetadata,
  GiftProduct,
  DEFAULT_GIFT_GUIDE_METADATA,
  DEFAULT_GUIDE_SETTINGS,
} from '../../types/giftGuide';
import { Editor } from '../Editor';
import { ProductCard } from './giftGuide/ProductCard';
import { GuideInfoDrawer } from './giftGuide/GuideInfoDrawer';
import { GuideFaqSection } from './giftGuide/GuideFaqSection';
import { geminiService } from '../../services/geminiClient';
import { cleanTrackingParameters, extractUrlsFromHtml } from '../../utils/urlUtils';
import { ensureSemanticHtml } from '../../utils/richText';
import {
  Gift,
  Plus,
  Trash2,
  Sparkles,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Package,
  Layers,
  HelpCircle,
  Sliders,
  FileText,
  Link2,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Wand2,
  Copy,
  Maximize2,
  ShieldCheck,
  Cpu,
} from 'lucide-react';
import { ModelId } from '../../types/models';
import { ALL_MODELS, getModelDefinition } from '../../services/modelRegistry';
import { storage } from '../../services/storage';

interface GiftGuideWorkspaceProps {
  project: WritingProject;
  editorRef?: React.MutableRefObject<any>;
  activePanel?: ActivePanel;
  onTogglePanel?: (panel: Exclude<ActivePanel, null>) => void;
  onChange: (updatedProject: WritingProject) => void;
  onRequestProposal: (proposal: DiffProposal) => void;
}

export const GiftGuideWorkspace: React.FC<GiftGuideWorkspaceProps> = ({
  project,
  editorRef,
  activePanel,
  onTogglePanel,
  onChange,
  onRequestProposal,
}) => {
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'canvas' | 'products' | 'sections'>('canvas');
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const [isGuideInfoOpen, setIsGuideInfoOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const meta: GiftGuideMetadata = useMemo(() => {
    return {
      ...DEFAULT_GIFT_GUIDE_METADATA,
      ...(project.giftGuideMeta || {}),
      settings: {
        ...DEFAULT_GUIDE_SETTINGS,
        ...(project.giftGuideMeta?.settings || {}),
      },
      products: project.giftGuideMeta?.products || [],
      faqList: project.giftGuideMeta?.faqList || [],
    };
  }, [project.giftGuideMeta]);

  const handleUpdateMeta = (field: keyof GiftGuideMetadata, value: any) => {
    onChange({
      ...project,
      giftGuideMeta: {
        ...meta,
        [field]: value,
      },
    });
  };

  // Duplicate URL Detection
  const duplicateUrls = useMemo(() => {
    const counts: Record<string, number> = {};
    meta.products.forEach((p) => {
      if (p.url && p.url.trim()) {
        const cleaned = cleanTrackingParameters(p.url.trim().toLowerCase());
        counts[cleaned] = (counts[cleaned] || 0) + 1;
      }
    });
    return new Set(
      Object.keys(counts).filter((url) => counts[url] > 1)
    );
  }, [meta.products]);

  // Product Management
  const handleAddProduct = () => {
    const newProd: GiftProduct = {
      id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: `Recommended Item #${meta.products.length + 1}`,
      url: '',
      summary: '',
      productType: '',
      materialDetails: '',
      historicalContext: '',
      designDetails: '',
      whyItFits: '',
      bestFor: '',
      buyerConsiderations: '',
      notes: '',
      productInstructions: '',
      generatedCopy: '',
      rawInfo: '',
    };
    const updated = [...meta.products, newProd];
    handleUpdateMeta('products', updated);
    // Expand the new product for editing
    setExpandedProductIds((prev) => new Set([...prev, newProd.id]));
  };

  const handleRemoveProduct = (id: string) => {
    const updated = meta.products.filter((p) => p.id !== id);
    handleUpdateMeta('products', updated);
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleDuplicateProduct = (prod: GiftProduct) => {
    const copy: GiftProduct = {
      ...prod,
      id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: `${prod.name} (Copy)`,
      generatedCopy: prod.generatedCopy,
    };
    const updated = [...meta.products, copy];
    handleUpdateMeta('products', updated);
    setExpandedProductIds((prev) => new Set([...prev, copy.id]));
  };

  const handleMoveProduct = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= meta.products.length) return;
    const nextProds = [...meta.products];
    const temp = nextProds[index];
    nextProds[index] = nextProds[targetIdx];
    nextProds[targetIdx] = temp;
    handleUpdateMeta('products', nextProds);
  };

  const handleUpdateProduct = (id: string, updates: Partial<GiftProduct>) => {
    const updated = meta.products.map((p) => (p.id === id ? { ...p, ...updates } : p));
    handleUpdateMeta('products', updated);
  };

  const handleToggleProductExpand = (id: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedProductIds(new Set(meta.products.map((p) => p.id)));
  };

  const handleCollapseAll = () => {
    setExpandedProductIds(new Set());
  };

  // AI Product Section Generator
  const handleGenerateProductSection = async (prod: GiftProduct) => {
    setIsLoading(true);
    try {
      const res = await geminiService.executeAction(project, 'generate_product_section', {
        relevantProduct: prod,
        targetProduct: prod,
        scope: 'section',
        customCommand: `Draft an unhurried, insightful entry for "${prod.name}". Follow the ${meta.settings?.sectionFormat || 'standard'} structure. Emphasize physical and tactile details from the provided specs without inventing facts. Avoid generic clichés like "perfect for" or "thoughtful gift".`,
      });

      if (res.ok && res.proposedText) {
        handleUpdateProduct(prod.id, { generatedCopy: res.proposedText });
        onRequestProposal({
          id: `prop-prod-${prod.id}-${Date.now()}`,
          scopeDescription: `Product Entry: "${prod.name}"`,
          targetText: prod.generatedCopy || '',
          proposedText: res.proposedText,
          modelUsed: res.modelUsed,
          explanation:
            res.explanation ||
            `Authored grounded, civilized product entry for "${prod.name}" respecting provided raw specifications.`,
          mode: 'insert',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // AI Product Action Dispatcher
  const handleExecuteProductAiAction = async (
    prod: GiftProduct,
    action: string,
    customCommand?: string
  ) => {
    setIsLoading(true);
    try {
      const res = await geminiService.executeAction(project, action, {
        relevantProduct: prod,
        targetProduct: prod,
        scope: 'section',
        customCommand: customCommand || `Refine product entry for "${prod.name}"`,
      });

      if (res.ok && res.proposedText) {
        if (action === 'generate_best_for') {
          // Extract plain text for bestFor field
          const cleanBestFor = res.proposedText.replace(/<[^>]+>/g, '').replace(/^best for:?\s*/i, '').trim();
          handleUpdateProduct(prod.id, { bestFor: cleanBestFor });
        }

        onRequestProposal({
          id: `prop-action-${prod.id}-${Date.now()}`,
          scopeDescription: `Product Action: ${action.replace(/_/g, ' ')} (${prod.name})`,
          targetText: prod.generatedCopy || '',
          proposedText: res.proposedText,
          modelUsed: res.modelUsed,
          explanation: res.explanation || `Elevated copy for "${prod.name}".`,
          mode: 'insert',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Insert individual product HTML into main editor
  const handleInsertProductIntoDraft = (prod: GiftProduct) => {
    const numPrefix = meta.settings?.numberProducts ? `${meta.products.findIndex(p => p.id === prod.id) + 1}. ` : '';
    const headingText = `${numPrefix}${prod.name}`;
    const headingHtml = prod.url ? `<h2><a href="${prod.url}">${headingText}</a></h2>` : `<h2>${headingText}</h2>`;

    let bodyHtml = prod.generatedCopy || `<p>${prod.summary || 'Product details pending...'}</p>`;
    if (meta.settings?.showBestFor && prod.bestFor && !bodyHtml.includes(prod.bestFor)) {
      bodyHtml += `<p><strong>Best for:</strong> ${prod.bestFor}</p>`;
    }

    const fullProductHtml = `${headingHtml}\n${bodyHtml}`;
    const updatedContent = project.content
      ? `${project.content}\n${fullProductHtml}`
      : fullProductHtml;

    onChange({
      ...project,
      content: ensureSemanticHtml(updatedContent),
    });
  };

  // AI Guide-Level Generators (Introduction, Buyer Advice, FAQ, Conclusion)
  const handleGenerateGuideSection = async (
    sectionType: 'generate_gift_guide_intro' | 'generate_buyer_advice' | 'generate_faq' | 'generate_conclusion' | 'generate_collection_link'
  ) => {
    setIsLoading(true);
    try {
      const res = await geminiService.executeAction(project, sectionType, {
        scope: 'all',
      });

      if (res.ok && res.proposedText) {
        if (sectionType === 'generate_buyer_advice') {
          handleUpdateMeta('buyerAdvice', res.proposedText);
        } else if (sectionType === 'generate_faq') {
          handleUpdateMeta('faq', res.proposedText);
        } else if (sectionType === 'generate_conclusion') {
          handleUpdateMeta('conclusion', res.proposedText);
        }

        onRequestProposal({
          id: `prop-guide-${sectionType}-${Date.now()}`,
          scopeDescription: `Guide Section: ${sectionType.replace(/generate_/g, '').replace(/_/g, ' ')}`,
          targetText: '',
          proposedText: res.proposedText,
          explanation: res.explanation || `Drafted elevated guide section for "${project.title}".`,
          mode: 'insert',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Assemble Complete Guide into Canvas
  const handleAssembleFullGuide = () => {
    let fullHtml = `<h1>${project.title}</h1>`;
    if (meta.standfirst) {
      fullHtml += `<p><em>${meta.standfirst}</em></p>`;
    }

    // Products
    meta.products.forEach((prod, idx) => {
      const numPrefix = meta.settings?.numberProducts ? `${idx + 1}. ` : '';
      const headingText = `${numPrefix}${prod.name}`;
      const headingHtml = prod.url
        ? `<h2><a href="${prod.url}">${headingText}</a></h2>`
        : `<h2>${headingText}</h2>`;

      let bodyHtml = prod.generatedCopy || `<p>${prod.summary || 'Product details pending...'}</p>`;
      if (meta.settings?.showBestFor && prod.bestFor && !bodyHtml.includes(prod.bestFor)) {
        bodyHtml += `<p><strong>Best for:</strong> ${prod.bestFor}</p>`;
      }

      fullHtml += `\n${headingHtml}\n${bodyHtml}`;
    });

    // Buyer Advice
    if (meta.settings?.showBuyerAdvice && meta.buyerAdvice) {
      fullHtml += `\n${meta.buyerAdvice}`;
    }

    // FAQ
    if (meta.settings?.showFaq) {
      if (meta.faqList && meta.faqList.length > 0) {
        fullHtml += `\n<h2>Frequently Asked Questions</h2>${meta.faqList
          .map((f) => `<p><strong>Q: ${f.question}</strong><br/>${f.answer}</p>`)
          .join('\n')}`;
      } else if (meta.faq) {
        fullHtml += `\n${meta.faq}`;
      }
    }

    // Conclusion
    if (meta.settings?.showConclusion && meta.conclusion) {
      fullHtml += `\n${meta.conclusion}`;
    }

    // Collection Link
    if (meta.settings?.includeCollectionLink && meta.collectionUrl) {
      fullHtml += `\n<p>Explore the full curated range in the <a href="${meta.collectionUrl}">Science of Gifts collection</a>.</p>`;
    }

    onChange({
      ...project,
      content: ensureSemanticHtml(fullHtml),
    });
  };

  // Filtered products
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return meta.products;
    const q = productSearch.toLowerCase();
    return meta.products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.productType && p.productType.toLowerCase().includes(q)) ||
        (p.summary && p.summary.toLowerCase().includes(q)) ||
        (p.bestFor && p.bestFor.toLowerCase().includes(q))
    );
  }, [meta.products, productSearch]);

  return (
    <div className="flex-1 flex flex-col bg-[#faf9f6] overflow-hidden">
      {/* TOP MASTHEAD / WORKSPACE CONTROLS */}
      <header className="px-3 sm:px-6 py-2.5 sm:py-3.5 bg-[#f6f3eb] border-b border-[#e5dfd3] shrink-0 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Left: Guide Title & Standfirst */}
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={project.title}
              onChange={(e) => onChange({ ...project, title: e.target.value })}
              placeholder="Gift Guide Headline..."
              className="w-full min-w-0 font-editorial text-xl md:text-2xl font-bold text-[#1e232a] bg-transparent focus:outline-hidden border-b border-transparent focus:border-amber-600 py-0.5 truncate"
            />

            <input
              type="text"
              value={meta.standfirst || ''}
              onChange={(e) => handleUpdateMeta('standfirst', e.target.value)}
              placeholder="Curatorial standfirst / short premise for why these items belong together..."
              className="w-full min-w-0 text-xs text-[#5c5447] italic bg-transparent focus:outline-hidden border-b border-transparent focus:border-amber-400 py-0.5 mt-0.5 truncate"
            />
          </div>

          {/* Right: View Toggles & Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* View Switcher Tabs */}
            <div className="flex bg-[#e8e2d5] p-0.5 rounded-lg text-xs font-medium text-[#4a443b] overflow-x-auto max-w-full">
              <button
                type="button"
                onClick={() => setActiveTab('canvas')}
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  activeTab === 'canvas'
                    ? 'bg-white shadow-2xs text-[#1e232a] font-semibold'
                    : 'hover:text-[#1e232a]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Interactive Canvas</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('products')}
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  activeTab === 'products'
                    ? 'bg-white shadow-2xs text-[#1e232a] font-semibold'
                    : 'hover:text-[#1e232a]'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Products List</span>
                <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                  {meta.products.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('sections')}
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  activeTab === 'sections'
                    ? 'bg-white shadow-2xs text-[#1e232a] font-semibold'
                    : 'hover:text-[#1e232a]'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Guide Sections & FAQ</span>
              </button>
            </div>

            {/* Guide Info & Settings Drawer Toggle */}
            <button
              type="button"
              onClick={() => setIsGuideInfoOpen(!isGuideInfoOpen)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors inline-flex items-center gap-1.5 shadow-2xs ${
                isGuideInfoOpen
                  ? 'bg-amber-100 text-amber-950 border-amber-300'
                  : 'bg-white text-[#5c5447] border-[#dcd6ca] hover:bg-[#ede8dc]'
              }`}
              title="Guide Info, Audience, Collection Link & Settings"
            >
              <Sliders className="w-3.5 h-3.5 text-amber-800" />
              <span>Guide Info & Settings</span>
            </button>
          </div>
        </div>

        {/* Action Strip: Quick AI Guide Triggers */}
        <div className="pt-2 border-t border-[#ede7db] flex items-center justify-between gap-3 text-xs overflow-x-auto">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c5447]">
              AI Guide Actions:
            </span>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleGenerateGuideSection('generate_gift_guide_intro')}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white hover:bg-[#ede8dc] border border-[#dcd6ca] text-[#2b251d] inline-flex items-center gap-1 transition-colors shadow-2xs disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3 text-amber-600" />
              <span>Generate Intro</span>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleGenerateGuideSection('generate_buyer_advice')}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white hover:bg-[#ede8dc] border border-[#dcd6ca] text-[#2b251d] inline-flex items-center gap-1 transition-colors shadow-2xs disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3 text-amber-600" />
              <span>Buyer Advice</span>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleGenerateGuideSection('generate_faq')}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white hover:bg-[#ede8dc] border border-[#dcd6ca] text-[#2b251d] inline-flex items-center gap-1 transition-colors shadow-2xs disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3 text-amber-600" />
              <span>Generate FAQs</span>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleGenerateGuideSection('generate_conclusion')}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-white hover:bg-[#ede8dc] border border-[#dcd6ca] text-[#2b251d] inline-flex items-center gap-1 transition-colors shadow-2xs disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3 text-amber-600" />
              <span>Conclusion</span>
            </button>

            <button
              type="button"
              onClick={() => (onTogglePanel ? onTogglePanel('review') : undefined)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 inline-flex items-center gap-1 transition-colors shadow-2xs"
              title="Open AI Editorial Review Panel"
            >
              <ShieldCheck className="w-3 h-3 text-amber-700" />
              <span>Editorial Review</span>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* AI Model Selector (Phase 9) */}
            <div className="flex items-center gap-1.5 bg-white border border-[#dcd6ca] px-2 py-0.5 rounded-md shadow-2xs text-xs">
              <Cpu className="w-3 h-3 text-indigo-700" />
              <span className="text-[10px] font-semibold text-[#7d7568] uppercase tracking-wider hidden md:inline">
                Model:
              </span>
              <select
                value={project.modelOverride || ''}
                onChange={(e) => {
                  onChange({
                    ...project,
                    modelOverride: (e.target.value as ModelId) || undefined,
                    updatedAt: new Date().toISOString(),
                  });
                }}
                className="bg-transparent text-[11px] font-semibold text-[#1e232a] focus:outline-hidden cursor-pointer"
                title={
                  project.modelOverride
                    ? `Project Override: ${getModelDefinition(project.modelOverride).displayName}`
                    : `Global Default: ${getModelDefinition(storage.getGlobalModel()).displayName}`
                }
              >
                <option value="">Default ({getModelDefinition(storage.getGlobalModel()).displayName})</option>
                {ALL_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleAssembleFullGuide}
              className="px-3 py-1 rounded-md text-[11px] font-semibold bg-[#1e232a] text-white hover:bg-[#2d3440] inline-flex items-center gap-1.5 shadow-2xs transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-300" />
              <span>Assemble Guide into Canvas</span>
            </button>
          </div>
        </div>
      </header>

      {/* WORKSPACE BODY */}
      <div className="flex-1 flex overflow-hidden">
        {/* VIEW 1: INTERACTIVE TWO-COLUMN CANVAS (PRODUCTS SIDEBAR + WYSIWYG EDITOR) */}
        {activeTab === 'canvas' && (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left Products Sidebar (Structured Inventory) */}
            <div className="w-full md:w-80 lg:w-96 max-h-72 md:max-h-none border-b md:border-b-0 md:border-r border-[#e5dfd3] bg-[#fcfbfa] flex flex-col shrink-0 overflow-hidden">
              {/* Products Header */}
              <div className="p-3.5 border-b border-[#e5dfd3] bg-[#f5f2ea] flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-amber-800" />
                  <h3 className="font-editorial text-sm font-bold text-[#1e232a]">
                    Products ({meta.products.length})
                  </h3>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleAddProduct}
                    className="px-2 py-1 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2d3440] rounded-md transition-colors inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Item</span>
                  </button>
                </div>
              </div>

              {/* Duplicate URL Warning Banner */}
              {duplicateUrls.size > 0 && (
                <div className="p-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-[11px] flex items-start gap-1.5 shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>Duplicate URLs detected:</strong> {duplicateUrls.size} product URL(s) appear more than once in this guide.
                  </span>
                </div>
              )}

              {/* Product Controls: Search & Expand/Collapse All */}
              <div className="p-2.5 border-b border-[#f0ece3] flex items-center justify-between gap-2 shrink-0 bg-white">
                <div className="relative flex-1">
                  <Search className="w-3 h-3 text-[#a8a194] absolute left-2 top-2" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Filter products..."
                    className="w-full pl-6 pr-2 py-1 text-[11px] rounded border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden"
                  />
                </div>

                <div className="flex items-center gap-1 text-[10px] text-[#736c61]">
                  <button
                    type="button"
                    onClick={handleExpandAll}
                    className="px-1.5 py-0.5 hover:text-[#1e232a] hover:bg-[#f5f2ea] rounded"
                  >
                    Expand All
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={handleCollapseAll}
                    className="px-1.5 py-0.5 hover:text-[#1e232a] hover:bg-[#f5f2ea] rounded"
                  >
                    Collapse
                  </button>
                </div>
              </div>

              {/* Product Cards List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {meta.products.length === 0 ? (
                  <div className="p-8 border border-dashed border-[#dcd6ca] rounded-xl text-center bg-white/50 space-y-2">
                    <Package className="w-6 h-6 text-[#a8a194] mx-auto" />
                    <p className="text-xs text-[#736c61]">No products added yet.</p>
                    <button
                      type="button"
                      onClick={handleAddProduct}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1e232a] rounded-lg shadow-2xs inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add First Product</span>
                    </button>
                  </div>
                ) : (
                  filteredProducts.map((product, idx) => {
                    const originalIdx = meta.products.findIndex((p) => p.id === product.id);
                    const isDup = Boolean(
                      product.url && duplicateUrls.has(cleanTrackingParameters(product.url.trim().toLowerCase()))
                    );

                    return (
                      <ProductCard
                        key={product.id}
                        product={product}
                        index={originalIdx}
                        totalCount={meta.products.length}
                        isExpanded={expandedProductIds.has(product.id)}
                        onToggleExpand={() => handleToggleProductExpand(product.id)}
                        onChange={(updates) => handleUpdateProduct(product.id, updates)}
                        onMove={(dir) => handleMoveProduct(originalIdx, dir)}
                        onDuplicate={() => handleDuplicateProduct(product)}
                        onDelete={() => handleRemoveProduct(product.id)}
                        onGenerateSection={handleGenerateProductSection}
                        onExecuteProductAiAction={handleExecuteProductAiAction}
                        onInsertIntoDraft={handleInsertProductIntoDraft}
                        isDuplicateUrl={isDup}
                        guideContext={{
                          title: project.title,
                          subtitle: meta.standfirst,
                          primaryTopic: meta.primaryTopic || project.title,
                          audience: meta.audience,
                          occasionOrNiche: meta.occasionOrNiche,
                          editorialBrief: meta.additionalInstructions,
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>

            {/* Center WYSIWYG Editor Canvas */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
              <Editor
                projectId={project.id}
                content={project.content}
                editorRef={editorRef}
                onChange={(newContent) =>
                  onChange({
                    ...project,
                    content: newContent,
                    updatedAt: new Date().toISOString(),
                  })
                }
                onExplicitAiAction={async (action, text, range) => {
                  setIsLoading(true);
                  try {
                    const res = await geminiService.executeAction(project, action, {
                      selectedText: text,
                      scope: 'selection',
                    });
                    if (res.ok && res.proposedText) {
                      onRequestProposal({
                        id: `prop-${Date.now()}`,
                        scopeDescription: `Selection: ${action.replace(/_/g, ' ')}`,
                        targetText: text,
                        proposedText: res.proposedText,
                        explanation: res.explanation || 'Refined selection.',
                        range,
                        mode: 'replace_selection',
                      });
                    }
                  } finally {
                    setIsLoading(false);
                  }
                }}
                onOpenCustomAi={(text, range) => {
                  onRequestProposal({
                    id: `prop-custom-${Date.now()}`,
                    scopeDescription: 'Custom Editorial Command',
                    targetText: text,
                    proposedText: text,
                    explanation: 'Enter a custom editorial instruction.',
                    range,
                  });
                }}
              />
            </div>
          </div>
        )}

        {/* VIEW 2: FULL PRODUCTS MANAGER */}
        {activeTab === 'products' && (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto max-w-4xl mx-auto space-y-4 w-full">
            <div className="flex items-center justify-between border-b border-[#e5dfd3] pb-4">
              <div>
                <h3 className="font-editorial text-xl font-bold text-[#1e232a]">
                  Structured Product Catalog ({meta.products.length} Items)
                </h3>
                <p className="text-xs text-[#736c61]">
                  Edit specifications, manage editorial sequence, and craft product entries.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddProduct}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2d3440] rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-2xs"
              >
                <Plus className="w-4 h-4" />
                <span>Add Product</span>
              </button>
            </div>

            <div className="space-y-3">
              {meta.products.map((product, idx) => {
                const isDup = Boolean(
                  product.url && duplicateUrls.has(cleanTrackingParameters(product.url.trim().toLowerCase()))
                );

                return (
                  <ProductCard
                    key={product.id}
                    product={product}
                    index={idx}
                    totalCount={meta.products.length}
                    isExpanded={expandedProductIds.has(product.id)}
                    onToggleExpand={() => handleToggleProductExpand(product.id)}
                    onChange={(updates) => handleUpdateProduct(product.id, updates)}
                    onMove={(dir) => handleMoveProduct(idx, dir)}
                    onDuplicate={() => handleDuplicateProduct(product)}
                    onDelete={() => handleRemoveProduct(product.id)}
                    onGenerateSection={handleGenerateProductSection}
                    onExecuteProductAiAction={handleExecuteProductAiAction}
                    onInsertIntoDraft={handleInsertProductIntoDraft}
                    isDuplicateUrl={isDup}
                    guideContext={{
                      title: project.title,
                      subtitle: meta.standfirst,
                      primaryTopic: meta.primaryTopic || project.title,
                      audience: meta.audience,
                      occasionOrNiche: meta.occasionOrNiche,
                      editorialBrief: meta.additionalInstructions,
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 3: GUIDE SECTIONS (BUYER ADVICE, FAQ, CONCLUSION) */}
        {activeTab === 'sections' && (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto max-w-4xl mx-auto space-y-6 w-full text-xs">
            {/* Buyer Advice Card */}
            <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-[#f0ece3] pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-amber-50 text-amber-900 flex items-center justify-center font-bold">
                    <BookOpen className="w-3.5 h-3.5 text-amber-800" />
                  </div>
                  <div>
                    <h4 className="font-editorial text-sm font-bold text-[#1e232a]">
                      Dedicated Buyer Advice
                    </h4>
                    <p className="text-[11px] text-[#736c61]">
                      Decision-making guidance: practical vs decorative gifts, sizing, and durability.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleGenerateGuideSection('generate_buyer_advice')}
                  className="px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors inline-flex items-center gap-1 shadow-2xs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Generate Buyer Advice</span>
                </button>
              </div>

              <textarea
                rows={4}
                value={meta.buyerAdvice || ''}
                onChange={(e) => handleUpdateMeta('buyerAdvice', e.target.value)}
                placeholder="Discerning buyer advice for this guide..."
                className="w-full p-2.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600 font-editorial text-xs leading-relaxed"
              />
            </div>

            {/* FAQ Section */}
            <GuideFaqSection
              faqList={meta.faqList || []}
              onChange={(updated) => handleUpdateMeta('faqList', updated)}
              onGenerateFaq={() => handleGenerateGuideSection('generate_faq')}
              onInsertIntoDraft={(faqHtml) => {
                onChange({
                  ...project,
                  content: ensureSemanticHtml((project.content || '') + '\n' + faqHtml),
                });
              }}
            />

            {/* Conclusion Card */}
            <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-[#f0ece3] pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-stone-100 text-stone-900 flex items-center justify-center font-bold">
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="font-editorial text-sm font-bold text-[#1e232a]">
                      Guide Conclusion
                    </h4>
                    <p className="text-[11px] text-[#736c61]">
                      Final reflection on the collection and lasting generosity.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleGenerateGuideSection('generate_conclusion')}
                  className="px-2.5 py-1.5 text-xs font-semibold text-amber-950 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors inline-flex items-center gap-1 shadow-2xs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Generate Conclusion</span>
                </button>
              </div>

              <textarea
                rows={3}
                value={meta.conclusion || ''}
                onChange={(e) => handleUpdateMeta('conclusion', e.target.value)}
                placeholder="Closing editorial perspective on this collection..."
                className="w-full p-2.5 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden focus:border-amber-600 font-editorial text-xs leading-relaxed"
              />
            </div>
          </div>
        )}
      </div>

      {/* GUIDE INFO & SETTINGS DRAWER (Mutually exclusive side panel) */}
      <GuideInfoDrawer
        isOpen={isGuideInfoOpen}
        onClose={() => setIsGuideInfoOpen(false)}
        meta={meta}
        projectTitle={project.title}
        onUpdateTitle={(newTitle) => onChange({ ...project, title: newTitle })}
        onUpdateMeta={handleUpdateMeta}
      />
    </div>
  );
};
