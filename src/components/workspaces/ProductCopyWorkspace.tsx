/**
 * Science of Gifts - Specialized Product Copy Studio (Phase 6 & Intelligent AI Product Research)
 * Separates structured product facts, editorial positioning, dedicated copy fields,
 * multi-variant generations, and SEO metadata while syncing directly with the rich-text editor.
 * Features intelligent AI-assisted product research, page scraping, and non-destructive
 * autofill with overwrite protection.
 */

import React, { useState } from 'react';
import {
  WritingProject,
  ProductCopyMetadata,
  ProductPositioning,
  ProductCopyVariants,
  DiffProposal,
  ActivePanel,
} from '../../types/project';
import { Editor } from '../Editor';
import { AiCommandBar } from '../AiCommandBar';
import { geminiService } from '../../services/geminiClient';
import { analyzeProductResearch } from '../../services/productResearchService';
import { ensureSemanticHtml } from '../../utils/richText';
import {
  Tag,
  Sparkles,
  Search,
  ExternalLink,
  ShieldCheck,
  Layers,
  FileCheck,
  Package,
  Compass,
  Type,
  List,
  History,
  Hammer,
  ArrowRight,
  Copy,
  Check,
  Globe,
  Sliders,
  Maximize2,
  Wand2,
  BookOpen,
  Eye,
  Info,
  Cpu,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  SearchCheck,
} from 'lucide-react';
import { ModelId } from '../../types/models';
import { ALL_MODELS, getModelDefinition } from '../../services/modelRegistry';
import { storage } from '../../services/storage';

interface ProductCopyWorkspaceProps {
  project: WritingProject;
  editorRef?: React.MutableRefObject<any>;
  activePanel?: ActivePanel;
  onTogglePanel?: (panel: Exclude<ActivePanel, null>) => void;
  onChange: (updatedProject: WritingProject) => void;
  onRequestProposal: (proposal: DiffProposal) => void;
}

export const ProductCopyWorkspace: React.FC<ProductCopyWorkspaceProps> = ({
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
  const [activeTab, setActiveTab] = useState<'canvas' | 'facts' | 'positioning' | 'copy_fields' | 'variants' | 'seo'>('canvas');
  const [copiedVariant, setCopiedVariant] = useState<string | null>(null);

  // AI Product Research & Autofill State
  const [isAnalyzingProduct, setIsAnalyzingProduct] = useState(false);
  const [researchStatusMsg, setResearchStatusMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [pendingFactSuggestions, setPendingFactSuggestions] = useState<Partial<Record<keyof ProductCopyMetadata, string>> | null>(null);
  const [canonicalUrlSuggestion, setCanonicalUrlSuggestion] = useState<string | null>(null);

  const defaultPositioning: ProductPositioning = {
    whatMakesItInteresting: '',
    whyWouldSomeoneWantIt: '',
    suitedRecipient: '',
    whatToEmphasize: '',
    whatToAvoid: '',
    keySellingAngle: '',
    emotionalAngle: '',
    historicalAngle: '',
  };

  const rawMeta: Partial<ProductCopyMetadata> = project.productCopyMeta || {};
  const meta: ProductCopyMetadata = {
    productName: project.title,
    productType: '',
    productUrl: '',
    imageUrl: '',
    rawProductInfo: '',
    designDescription: '',
    designConcept: '',
    historicalContext: '',
    materials: '',
    features: '',
    dimensions: '',
    colors: '',
    intendedRecipient: '',
    targetAudience: '',
    productNotes: '',
    additionalFacts: '',
    productTitle: project.title,
    headline: '',
    standfirst: '',
    description: '',
    bestFor: '',
    keyFeaturesBullets: [],
    historicalAngleCopy: '',
    materialsCraftNote: '',
    callToAction: '',
    shortCopySocial: '',
    ecommerceBullets: [],
    variants: {
      formalEditorial: '',
      emotionalStorytelling: '',
      conciseConversion: '',
      technicalHistorical: '',
    },
    slug: '',
    seoTitle: '',
    metaDescription: '',
    primaryKeyword: '',
    secondaryKeywords: [],
    ...rawMeta,
    positioning:
      typeof rawMeta.positioning === 'object' && rawMeta.positioning !== null
        ? { ...defaultPositioning, ...rawMeta.positioning }
        : defaultPositioning,
  };

  const handleUpdateMeta = (field: keyof ProductCopyMetadata, value: any) => {
    onChange({
      ...project,
      title: field === 'productName' && value ? value : project.title,
      productCopyMeta: {
        ...meta,
        [field]: value,
      },
    });
  };

  const handleUpdatePositioning = (field: keyof ProductPositioning, value: string) => {
    handleUpdateMeta('positioning', {
      ...(meta.positioning || {}),
      [field]: value,
    });
  };

  const handleUpdateVariants = (variantKey: keyof ProductCopyVariants, text: string) => {
    handleUpdateMeta('variants', {
      ...(meta.variants || {}),
      [variantKey]: text,
    });
  };

  // AI Product Research Analysis Handler
  const handleFetchAndAnalyzeProduct = async () => {
    if (!meta.productUrl || !meta.productUrl.trim()) {
      setResearchStatusMsg({ text: 'Please enter or paste a product URL to analyze.', isError: true });
      return;
    }

    setIsAnalyzingProduct(true);
    setResearchStatusMsg({ text: 'Connecting to product URL, extracting JSON-LD specs, and running AI research analysis...' });

    try {
      const res = await analyzeProductResearch(meta.productUrl, project.modelOverride);
      if (!res.ok || !res.metadata) {
        setResearchStatusMsg({
          text: res.error || 'Unable to retrieve product details. Manual editing remains available.',
          isError: true,
        });
        return;
      }

      const m = res.metadata;
      const directUpdates: Partial<ProductCopyMetadata> = {};
      const newSuggestions: Partial<Record<keyof ProductCopyMetadata, string>> = {};

      const fieldsToMap: Array<{ key: keyof ProductCopyMetadata; fetchedValue?: string }> = [
        { key: 'productName', fetchedValue: m.productName },
        { key: 'productType', fetchedValue: m.productType },
        { key: 'imageUrl', fetchedValue: m.imageUrl },
        { key: 'materials', fetchedValue: m.materials },
        { key: 'features', fetchedValue: m.features },
        { key: 'dimensions', fetchedValue: m.dimensions },
        { key: 'colors', fetchedValue: m.colors },
        { key: 'designConcept', fetchedValue: m.designConcept },
        { key: 'historicalContext', fetchedValue: m.historicalContext },
        { key: 'intendedRecipient', fetchedValue: m.intendedRecipient },
        { key: 'targetAudience', fetchedValue: m.targetAudience },
        { key: 'additionalFacts', fetchedValue: m.additionalFacts },
        { key: 'rawProductInfo', fetchedValue: m.rawProductInfo },
      ];

      let filledCount = 0;
      let suggestionCount = 0;

      fieldsToMap.forEach(({ key, fetchedValue }) => {
        if (!fetchedValue || !fetchedValue.trim()) return;
        const cleanVal = fetchedValue.trim();
        const currentVal = (meta[key] || '').toString().trim();

        if (!currentVal) {
          // Auto-fill empty fields directly
          (directUpdates as any)[key] = cleanVal;
          filledCount++;
        } else if (currentVal !== cleanVal) {
          // Non-destructive suggestion for populated fields
          (newSuggestions as any)[key] = cleanVal;
          suggestionCount++;
        }
      });

      if (m.canonicalUrl && m.canonicalUrl.trim() && m.canonicalUrl.trim().toLowerCase() !== meta.productUrl.trim().toLowerCase()) {
        setCanonicalUrlSuggestion(m.canonicalUrl.trim());
      } else {
        setCanonicalUrlSuggestion(null);
      }

      // Apply auto-filled direct updates
      if (Object.keys(directUpdates).length > 0) {
        onChange({
          ...project,
          title: directUpdates.productName || project.title,
          productCopyMeta: {
            ...meta,
            ...directUpdates,
          } as ProductCopyMetadata,
        });
      }

      if (Object.keys(newSuggestions).length > 0) {
        setPendingFactSuggestions(newSuggestions);
      } else {
        setPendingFactSuggestions(null);
      }

      let msg = '';
      if (filledCount > 0 && suggestionCount > 0) {
        msg = `AI Product Research complete! Populated ${filledCount} empty field(s). ${suggestionCount} field(s) have pending suggestions below.`;
      } else if (filledCount > 0) {
        msg = `AI Product Research complete! Populated ${filledCount} field(s) from product page.`;
      } else if (suggestionCount > 0) {
        msg = `AI Product Research complete! Found ${suggestionCount} suggested update(s) for populated fields below.`;
      } else {
        msg = `AI Product Research complete. All product fields are up to date.`;
      }

      setResearchStatusMsg({ text: msg, isError: false });
    } catch (err: any) {
      setResearchStatusMsg({
        text: err?.message || 'Product research analysis failed.',
        isError: true,
      });
    } finally {
      setIsAnalyzingProduct(false);
    }
  };

  const handleApplyFactSuggestion = (key: keyof ProductCopyMetadata) => {
    if (!pendingFactSuggestions || !pendingFactSuggestions[key]) return;
    const val = pendingFactSuggestions[key]!;
    handleUpdateMeta(key, val);

    const next = { ...pendingFactSuggestions };
    delete next[key];
    setPendingFactSuggestions(Object.keys(next).length > 0 ? next : null);
  };

  const handleDismissFactSuggestion = (key: keyof ProductCopyMetadata) => {
    if (!pendingFactSuggestions) return;
    const next = { ...pendingFactSuggestions };
    delete next[key];
    setPendingFactSuggestions(Object.keys(next).length > 0 ? next : null);
  };

  const handleApplyAllFactSuggestions = () => {
    if (!pendingFactSuggestions) return;
    onChange({
      ...project,
      productCopyMeta: {
        ...meta,
        ...pendingFactSuggestions,
      } as ProductCopyMetadata,
    });
    setPendingFactSuggestions(null);
  };

  const handleDismissAllFactSuggestions = () => {
    setPendingFactSuggestions(null);
  };

  // AI Action Dispatcher for Product Copy
  const handleExecuteAiAction = async (action: string, customCommand?: string, scope: any = 'selection') => {
    setIsLoading(true);
    try {
      const res = await geminiService.executeAction(project, action, {
        selectedText: scope === 'selection' ? selectedText : undefined,
        scope,
        customCommand,
        relevantProduct: meta,
      });

      if (res.ok && res.proposedText) {
        onRequestProposal({
          id: `prop-${Date.now()}`,
          scopeDescription:
            scope === 'selection' && selectedText
              ? `Selected text (${selectedText.split(/\s+/).filter(Boolean).length} words)`
              : action.replace(/_/g, ' '),
          targetText: scope === 'selection' ? selectedText : project.content,
          proposedText: res.proposedText,
          explanation: res.explanation || 'Refined product copy according to editorial guidelines.',
          range: scope === 'selection' ? selectionRange : undefined,
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // AI Full Copy Generation
  const handleGenerateFullCopy = async () => {
    setIsLoading(true);
    try {
      const res = await geminiService.executeAction(project, 'generate_product_copy', {
        relevantProduct: meta,
        customCommand:
          'Create complete grounded product copy. Provide a captivating headline, italic standfirst, detailed description, Best For recommendation, key features, materials note, and call to action based strictly on the raw specifications.',
      });

      if (res.ok && res.proposedText) {
        onRequestProposal({
          id: `prop-full-copy-${Date.now()}`,
          scopeDescription: 'Full Product Copy Generation',
          targetText: project.content,
          proposedText: res.proposedText,
          modelUsed: res.modelUsed,
          explanation:
            res.explanation || 'Constructed grounded editorial product copy honoring all factual specifications.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Generate Single Structured Field
  const handleGenerateSingleField = async (
    field:
      | 'headline'
      | 'standfirst'
      | 'description'
      | 'bestFor'
      | 'historicalAngleCopy'
      | 'materialsCraftNote'
      | 'callToAction'
      | 'shortCopySocial'
      | 'seoTitle'
      | 'metaDescription'
  ) => {
    setIsLoading(true);
    try {
      const actionMap: Record<string, string> = {
        headline: 'create_headline',
        standfirst: 'create_standfirst',
        description: 'generate_product_copy',
        bestFor: 'create_best_for',
        historicalAngleCopy: 'add_product_historical_context',
        materialsCraftNote: 'create_materials_note',
        callToAction: 'create_cta',
        shortCopySocial: 'create_social_copy',
        seoTitle: 'create_seo_title',
        metaDescription: 'create_meta_description',
      };

      const action = actionMap[field] || 'generate_product_copy';
      const res = await geminiService.executeAction(project, action, {
        relevantProduct: meta,
      });

      if (res.ok && res.proposedText) {
        const cleaned = res.proposedText.replace(/^["']|["']$/g, '').trim();
        handleUpdateMeta(field, cleaned);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Generate Multi-Variants
  const handleGenerateVariants = async () => {
    setIsLoading(true);
    try {
      const variantsList: Array<{ key: keyof ProductCopyVariants; prompt: string }> = [
        {
          key: 'formalEditorial',
          prompt: 'Write formal, elevated editorial copy suited for a print journal or luxury monograph. Focus on craftsmanship, provenance, and quiet restraint.',
        },
        {
          key: 'emotionalStorytelling',
          prompt: 'Write narrative storytelling copy evoking tactile rituals, heritage, and the feeling of owning an enduring object.',
        },
        {
          key: 'conciseConversion',
          prompt: 'Write crisp, punchy, conversion-focused product description suitable for a fast-reading web showcase without vulgar hype.',
        },
        {
          key: 'technicalHistorical',
          prompt: 'Write technical and historical detail copy emphasizing materials, gauge, dimensions, SELVEDGE/alloy details, and tool lineage.',
        },
      ];

      const newVariants: ProductCopyVariants = { ...meta.variants };

      for (const v of variantsList) {
        const res = await geminiService.executeAction(project, 'generate_product_copy', {
          relevantProduct: meta,
          customCommand: v.prompt,
        });
        if (res.ok && res.proposedText) {
          newVariants[v.key] = res.proposedText;
        }
      }

      handleUpdateMeta('variants', newVariants);
      setActiveTab('variants');
    } finally {
      setIsLoading(false);
    }
  };

  // Compile Structured Copy Fields into Rich-Text Editor Canvas
  const handleCompileToEditor = (overrideHtml?: string) => {
    if (overrideHtml) {
      onChange({
        ...project,
        content: ensureSemanticHtml(overrideHtml),
      });
      setActiveTab('canvas');
      return;
    }

    let formatted = `<h2>${meta.headline || meta.productTitle || project.title}</h2>`;
    if (meta.standfirst) {
      formatted += `<p><em>${meta.standfirst}</em></p>`;
    }
    if (meta.description) {
      formatted += `\n<p>${meta.description}</p>`;
    }
    if (meta.bestFor) {
      formatted += `\n<p><strong>Best Suited For:</strong> ${meta.bestFor}</p>`;
    }
    if (meta.materialsCraftNote || meta.materials) {
      formatted += `\n<h3>Materials & Bench Craftsmanship</h3><p>${meta.materialsCraftNote || meta.materials}</p>`;
    }
    if (meta.historicalAngleCopy || meta.historicalContext) {
      formatted += `\n<h3>Historical & Tool Heritage</h3><p>${meta.historicalAngleCopy || meta.historicalContext}</p>`;
    }
    if (meta.callToAction) {
      formatted += `\n<p><strong>${meta.callToAction}</strong></p>`;
    }

    onChange({
      ...project,
      content: ensureSemanticHtml(formatted),
    });
    setActiveTab('canvas');
  };

  const handleCopyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedVariant(key);
    setTimeout(() => setCopiedVariant(null), 2000);
  };

  const renderFactSuggestionPill = (key: keyof ProductCopyMetadata, label: string, isFact = true) => {
    if (!pendingFactSuggestions || !pendingFactSuggestions[key]) return null;
    const val = pendingFactSuggestions[key]!;

    return (
      <div className="mt-1.5 p-2 bg-amber-50/90 border border-amber-200/90 rounded-lg text-xs space-y-1 animate-in fade-in duration-100">
        <div className="flex items-center justify-between text-[11px] font-semibold text-amber-950">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-700" />
            <span>Suggested {label} ({isFact ? 'Verified Source Fact' : 'AI Editorial Analysis'}):</span>
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleApplyFactSuggestion(key)}
              className="px-2 py-0.5 bg-amber-900 text-white hover:bg-amber-950 rounded text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer shadow-2xs"
            >
              <Check className="w-3 h-3" />
              <span>Apply</span>
            </button>
            <button
              type="button"
              onClick={() => handleDismissFactSuggestion(key)}
              className="px-1.5 py-0.5 text-amber-800 hover:text-amber-950 text-[10px] font-medium cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
        <p className="text-[11px] text-amber-900 leading-relaxed italic bg-white/70 p-1.5 rounded border border-amber-200/50 break-words">
          "{val}"
        </p>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-[#faf9f6] overflow-hidden">
      {/* HEADER BAR */}
      <header className="px-3 sm:px-6 py-2.5 sm:py-3.5 bg-[#f6f3eb] border-b border-[#e5dfd3] shrink-0 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={project.title}
              onChange={(e) => {
                onChange({ ...project, title: e.target.value });
                handleUpdateMeta('productName', e.target.value);
              }}
              placeholder="Product Name..."
              className="w-full min-w-0 font-editorial text-xl md:text-2xl font-bold text-[#1e232a] bg-transparent focus:outline-hidden border-b border-transparent focus:border-emerald-600 py-0.5 truncate"
            />

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 text-xs text-[#5c5447]">
              <input
                type="text"
                value={meta.productType}
                onChange={(e) => handleUpdateMeta('productType', e.target.value)}
                placeholder="Category / Type (e.g. Field Watch, Canvas Duffel)"
                className="bg-transparent focus:outline-hidden border-b border-transparent focus:border-emerald-400 py-0.5 text-xs text-[#5c5447]"
              />
              <span className="text-[#dcd6ca]">•</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={meta.productUrl}
                  onChange={(e) => handleUpdateMeta('productUrl', e.target.value)}
                  placeholder="Product URL (https://...)"
                  className="bg-transparent focus:outline-hidden border-b border-transparent focus:border-emerald-400 py-0.5 text-xs font-mono text-[#736c61]"
                />
                {/* Header Fetch & Analyze Action */}
                <button
                  type="button"
                  disabled={isAnalyzingProduct || !meta.productUrl || !meta.productUrl.trim()}
                  onClick={handleFetchAndAnalyzeProduct}
                  className="px-2 py-0.5 text-[11px] font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors shadow-2xs"
                  title="Research product page, extract JSON-LD specs, and analyze with Gemini AI"
                >
                  {isAnalyzingProduct ? (
                    <Loader2 className="w-3 h-3 animate-spin text-amber-800" />
                  ) : (
                    <SearchCheck className="w-3 h-3 text-amber-800" />
                  )}
                  <span>{isAnalyzingProduct ? 'Analyzing...' : 'Fetch & Analyze'}</span>
                </button>

                {meta.productUrl && (
                  <a
                    href={meta.productUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#8c8477] hover:text-[#1e232a]"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* View Mode Switcher Tabs */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
                onClick={() => setActiveTab('facts')}
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  activeTab === 'facts'
                    ? 'bg-white shadow-2xs text-[#1e232a] font-semibold'
                    : 'hover:text-[#1e232a]'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Product Facts</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('positioning')}
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  activeTab === 'positioning'
                    ? 'bg-white shadow-2xs text-[#1e232a] font-semibold'
                    : 'hover:text-[#1e232a]'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Positioning</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('copy_fields')}
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  activeTab === 'copy_fields'
                    ? 'bg-white shadow-2xs text-[#1e232a] font-semibold'
                    : 'hover:text-[#1e232a]'
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                <span>Copy Fields</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('variants')}
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  activeTab === 'variants'
                    ? 'bg-white shadow-2xs text-[#1e232a] font-semibold'
                    : 'hover:text-[#1e232a]'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5 text-amber-700" />
                <span>Multi-Variants</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('seo')}
                className={`px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  activeTab === 'seo'
                    ? 'bg-white shadow-2xs text-[#1e232a] font-semibold'
                    : 'hover:text-[#1e232a]'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>SEO</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Action Strip */}
        <div className="pt-2 border-t border-[#ede7db] flex items-center justify-between gap-3 text-xs overflow-x-auto">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#5c5447]">
              AI Generation:
            </span>
            <button
              type="button"
              disabled={isLoading}
              onClick={handleGenerateFullCopy}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 inline-flex items-center gap-1 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              <Sparkles className="w-3 h-3 text-amber-700" />
              <span>Generate Full Copy</span>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={handleGenerateVariants}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-950 inline-flex items-center gap-1 transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              <Wand2 className="w-3 h-3 text-emerald-700" />
              <span>Generate 4 Style Variants</span>
            </button>

            <button
              type="button"
              onClick={() => (onTogglePanel ? onTogglePanel('review') : undefined)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 inline-flex items-center gap-1 transition-colors shadow-2xs cursor-pointer"
              title="Open AI Editorial Review Panel"
            >
              <ShieldCheck className="w-3 h-3 text-amber-700" />
              <span>Editorial Review</span>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* AI Model Selector */}
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
              onClick={() => handleCompileToEditor()}
              className="px-3 py-1 rounded-md text-[11px] font-semibold bg-[#1e232a] text-white hover:bg-[#2d3440] inline-flex items-center gap-1.5 shadow-2xs transition-colors shrink-0 cursor-pointer"
            >
              <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Assemble into Canvas</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT BODY */}
      <div className="flex-1 flex overflow-hidden">
        {/* TAB 1: INTERACTIVE CANVAS */}
        {activeTab === 'canvas' && (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left Specs & Copy Quick Panel */}
            <div className="w-full md:w-80 lg:w-96 max-h-56 md:max-h-none border-b md:border-b-0 md:border-r border-[#e5dfd3] bg-[#fcfbfa] flex flex-col shrink-0 overflow-y-auto p-4 space-y-5 text-xs">
              <div className="p-3 bg-amber-50/90 border border-amber-200 rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-amber-950 font-semibold text-[11px]">
                  <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Factual Source Discipline</span>
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  Structured product facts serve as source truth. AI will never invent measurements, origins, or material specs.
                </p>
              </div>

              {/* Raw Facts Summary Card */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3">
                <div className="flex items-center justify-between border-b border-[#f0ece3] pb-2">
                  <h4 className="font-editorial font-bold text-sm text-[#1e232a]">
                    Structured Facts
                  </h4>
                  <button
                    type="button"
                    onClick={() => setActiveTab('facts')}
                    className="text-[10px] font-semibold text-amber-800 hover:underline"
                  >
                    Edit All Facts →
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61] block mb-1">
                    Raw Specification Notes
                  </label>
                  <textarea
                    rows={3}
                    value={meta.rawProductInfo}
                    onChange={(e) => handleUpdateMeta('rawProductInfo', e.target.value)}
                    placeholder="Paste raw manufacturer details..."
                    className="w-full text-xs p-2 rounded border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white"
                  />
                </div>

                <div className="space-y-1.5 text-[11px]">
                  <div>
                    <span className="font-semibold text-[#443d34]">Materials: </span>
                    <span className="text-[#6e685f]">{meta.materials || 'Not specified'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[#443d34]">Features: </span>
                    <span className="text-[#6e685f]">{meta.features || 'Not specified'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[#443d34]">Heritage: </span>
                    <span className="text-[#6e685f]">{meta.historicalContext || 'Not specified'}</span>
                  </div>
                </div>
              </div>

              {/* Copy Fields Quick Panel */}
              <div className="p-4 bg-white border border-emerald-200/90 rounded-xl shadow-2xs space-y-3">
                <div className="flex items-center justify-between border-b border-[#f0ece3] pb-2">
                  <h4 className="font-editorial font-bold text-sm text-emerald-950 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
                    Structured Copy Preview
                  </h4>
                  <button
                    type="button"
                    onClick={() => setActiveTab('copy_fields')}
                    className="text-[10px] font-semibold text-emerald-800 hover:underline"
                  >
                    All Fields →
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61] block mb-0.5">
                    Headline
                  </label>
                  <input
                    type="text"
                    value={meta.headline || ''}
                    onChange={(e) => handleUpdateMeta('headline', e.target.value)}
                    placeholder="Headline..."
                    className="w-full text-xs font-editorial font-semibold p-1.5 rounded border border-[#dcd6ca] bg-[#faf9f6]"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61] block mb-0.5">
                    Standfirst
                  </label>
                  <input
                    type="text"
                    value={meta.standfirst || ''}
                    onChange={(e) => handleUpdateMeta('standfirst', e.target.value)}
                    placeholder="Standfirst..."
                    className="w-full text-xs italic p-1.5 rounded border border-[#dcd6ca] bg-[#faf9f6]"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#736c61] block mb-0.5">
                    Best Suited For
                  </label>
                  <input
                    type="text"
                    value={meta.bestFor || ''}
                    onChange={(e) => handleUpdateMeta('bestFor', e.target.value)}
                    placeholder="Best for..."
                    className="w-full text-xs p-1.5 rounded border border-[#dcd6ca] bg-[#faf9f6]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleCompileToEditor()}
                  className="w-full py-2 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2d3440] rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Assemble Fields into Canvas</span>
                </button>
              </div>
            </div>

            {/* Center Rich-Text Editor Canvas */}
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
                onSelectionChange={(text, range) => {
                  setSelectedText(text);
                  setSelectionRange(range);
                }}
                onExplicitAiAction={(action, text, range) => {
                  setSelectedText(text);
                  setSelectionRange(range);
                  handleExecuteAiAction(action, undefined, text ? 'selection' : 'all');
                }}
              />
            </div>
          </div>
        )}

        {/* TAB 2: PRODUCT INFORMATION (FACTS) */}
        {activeTab === 'facts' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6 text-xs">
            <div className="border-b border-[#e5dfd3] pb-3">
              <h3 className="font-editorial text-xl font-bold text-[#1e232a]">
                Product Specifications & Fact Inventory
              </h3>
              <p className="text-xs text-[#736c61] mt-0.5">
                The AI treats empty fields as unknown. It will never invent missing specifications or details.
              </p>
            </div>

            {/* AI PRODUCT RESEARCH & AUTOFILL CARD */}
            <div className="p-5 bg-gradient-to-br from-amber-50/90 to-amber-100/40 border border-amber-300/80 rounded-2xl shadow-sm space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-200/80 pb-3">
                <div className="flex items-center gap-2 text-amber-950 font-semibold text-sm">
                  <Sparkles className="w-5 h-5 text-amber-700 shrink-0" />
                  <div>
                    <h4 className="font-editorial font-bold text-base text-amber-950">
                      Intelligent AI Product Research & Autofill
                    </h4>
                    <p className="text-xs text-amber-900 font-normal">
                      Retrieve product page specs, JSON-LD, materials, and run AI research analysis to populate Product Facts fields.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isAnalyzingProduct || !meta.productUrl || !meta.productUrl.trim()}
                  onClick={handleFetchAndAnalyzeProduct}
                  className="px-4 py-2 text-xs font-bold text-white bg-amber-900 hover:bg-amber-950 rounded-xl transition-colors inline-flex items-center gap-2 shadow-xs shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isAnalyzingProduct ? (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                  ) : (
                    <SearchCheck className="w-4 h-4 text-amber-300" />
                  )}
                  <span>{isAnalyzingProduct ? 'Analyzing Product...' : 'Fetch & Analyze Product'}</span>
                </button>
              </div>

              {/* Status Message / Progress Box */}
              {researchStatusMsg && (
                <div
                  className={`p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 animate-in fade-in duration-150 ${
                    researchStatusMsg.isError
                      ? 'bg-rose-50 text-rose-900 border border-rose-200'
                      : 'bg-emerald-50 text-emerald-950 border border-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {researchStatusMsg.isError ? (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    )}
                    <span className="truncate">{researchStatusMsg.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setResearchStatusMsg(null)}
                    className="p-0.5 text-stone-500 hover:text-stone-800 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* PENDING SUGGESTIONS BANNER */}
              {pendingFactSuggestions && Object.keys(pendingFactSuggestions).length > 0 && (
                <div className="p-3 bg-amber-100/90 border border-amber-300 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-amber-950 min-w-0 font-medium">
                    <Sparkles className="w-4 h-4 text-amber-800 shrink-0" />
                    <span className="truncate">
                      AI Product Research found <strong>{Object.keys(pendingFactSuggestions).length}</strong> suggested updates for populated fields below.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleApplyAllFactSuggestions}
                      className="px-3 py-1 text-xs font-bold text-white bg-amber-900 hover:bg-amber-950 rounded-lg transition-colors cursor-pointer shadow-2xs"
                    >
                      Apply All
                    </button>
                    <button
                      type="button"
                      onClick={handleDismissAllFactSuggestions}
                      className="px-2 py-1 text-xs font-medium text-amber-900 hover:text-amber-950 cursor-pointer"
                    >
                      Dismiss All
                    </button>
                  </div>
                </div>
              )}

              {/* CANONICAL URL SUGGESTION PILL */}
              {canonicalUrlSuggestion && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-950 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="truncate text-[11px]">
                      Canonical Product URL: <code className="font-mono">{canonicalUrlSuggestion}</code>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        handleUpdateMeta('productUrl', canonicalUrlSuggestion);
                        setCanonicalUrlSuggestion(null);
                      }}
                      className="px-2 py-0.5 bg-emerald-800 text-white hover:bg-emerald-950 rounded text-[10px] font-bold cursor-pointer"
                    >
                      Use Canonical
                    </button>
                    <button
                      type="button"
                      onClick={() => setCanonicalUrlSuggestion(null)}
                      className="px-1.5 py-0.5 text-emerald-800 hover:text-emerald-950 text-[10px] font-medium cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Verbatim Raw Info Box */}
            <div className="p-5 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-3">
              <label className="block font-bold text-xs uppercase tracking-wider text-[#443d34]">
                Raw Manufacturer Specification Notes (Verbatim Source Material)
              </label>
              <textarea
                rows={5}
                value={meta.rawProductInfo}
                onChange={(e) => handleUpdateMeta('rawProductInfo', e.target.value)}
                placeholder="Paste verbatim manufacturer spec sheets, caliber details, alloy designations, or maker catalog notes..."
                className="w-full text-xs p-3 rounded-lg border border-[#dcd6ca] bg-[#faf9f6] focus:bg-white focus:outline-hidden font-mono text-[#1e232a] leading-relaxed"
              />
              {renderFactSuggestionPill('rawProductInfo', 'Raw Spec Notes', true)}
            </div>

            {/* Structured Fact Grid */}
            <div className="p-5 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-4">
              <h4 className="font-editorial font-bold text-sm text-[#1e232a] border-b border-[#f0ece3] pb-2">
                Physical & Design Attributes
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Product Name</label>
                  <input
                    type="text"
                    value={meta.productName}
                    onChange={(e) => handleUpdateMeta('productName', e.target.value)}
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('productName', 'Product Name', true)}
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Product Type / Category</label>
                  <input
                    type="text"
                    value={meta.productType}
                    onChange={(e) => handleUpdateMeta('productType', e.target.value)}
                    placeholder="e.g. Mechanical Chronograph, Leather Folio"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('productType', 'Product Category', true)}
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Product URL</label>
                  <input
                    type="text"
                    value={meta.productUrl}
                    onChange={(e) => handleUpdateMeta('productUrl', e.target.value)}
                    placeholder="https://..."
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white font-mono"
                  />
                  {renderFactSuggestionPill('productUrl', 'Product URL', true)}
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Image URL or Reference</label>
                  <input
                    type="text"
                    value={meta.imageUrl || ''}
                    onChange={(e) => handleUpdateMeta('imageUrl', e.target.value)}
                    placeholder="https://... image link"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white font-mono"
                  />
                  {renderFactSuggestionPill('imageUrl', 'Product Image URL', true)}
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Materials & Provenance</label>
                  <input
                    type="text"
                    value={meta.materials || ''}
                    onChange={(e) => handleUpdateMeta('materials', e.target.value)}
                    placeholder="e.g. Horween Chromexcel leather, Japanese brass hardware"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('materials', 'Materials', true)}
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Physical Features</label>
                  <input
                    type="text"
                    value={meta.features || ''}
                    onChange={(e) => handleUpdateMeta('features', e.target.value)}
                    placeholder="e.g. YKK brass zips, padded compartment, weather-sealed"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('features', 'Physical Features', true)}
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Dimensions & Weight</label>
                  <input
                    type="text"
                    value={meta.dimensions || ''}
                    onChange={(e) => handleUpdateMeta('dimensions', e.target.value)}
                    placeholder="e.g. 38mm diameter, 11.5mm thickness, 140g"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('dimensions', 'Dimensions', true)}
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Colors & Finishes</label>
                  <input
                    type="text"
                    value={meta.colors || ''}
                    onChange={(e) => handleUpdateMeta('colors', e.target.value)}
                    placeholder="e.g. Matte Olive Drab, Burnished Tan, Raw Brass"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('colors', 'Colors & Finishes', true)}
                </div>
              </div>

              <div className="pt-2 border-t border-[#f0ece3] space-y-3">
                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Design Concept & Aesthetics</label>
                  <textarea
                    rows={2}
                    value={meta.designConcept || ''}
                    onChange={(e) => handleUpdateMeta('designConcept', e.target.value)}
                    placeholder="Core aesthetic philosophy or visual language..."
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('designConcept', 'Design Concept', false)}
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Historical / Cultural Context</label>
                  <textarea
                    rows={2}
                    value={meta.historicalContext || ''}
                    onChange={(e) => handleUpdateMeta('historicalContext', e.target.value)}
                    placeholder="Tool heritage, historical era inspiration, or maker lineage..."
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('historicalContext', 'Historical Context', false)}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-[#5c5447] mb-1">Intended Recipient</label>
                    <input
                      type="text"
                      value={meta.intendedRecipient || ''}
                      onChange={(e) => handleUpdateMeta('intendedRecipient', e.target.value)}
                      placeholder="e.g. Map collectors, field architects, writers"
                      className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                    />
                    {renderFactSuggestionPill('intendedRecipient', 'Intended Recipient', false)}
                  </div>

                  <div>
                    <label className="block font-semibold text-[#5c5447] mb-1">Target Audience</label>
                    <input
                      type="text"
                      value={meta.targetAudience || ''}
                      onChange={(e) => handleUpdateMeta('targetAudience', e.target.value)}
                      placeholder="e.g. Discerning enthusiasts who value durability over trends"
                      className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                    />
                    {renderFactSuggestionPill('targetAudience', 'Target Audience', false)}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Additional Factual Notes</label>
                  <textarea
                    rows={2}
                    value={meta.additionalFacts || ''}
                    onChange={(e) => handleUpdateMeta('additionalFacts', e.target.value)}
                    placeholder="Any remaining verifiable factual claims..."
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                  {renderFactSuggestionPill('additionalFacts', 'Additional Facts', true)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PRODUCT POSITIONING */}
        {activeTab === 'positioning' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6 text-xs">
            <div className="border-b border-[#e5dfd3] pb-3">
              <h3 className="font-editorial text-xl font-bold text-[#1e232a]">
                Editorial Product Positioning & Angles
              </h3>
              <p className="text-xs text-[#736c61] mt-0.5">
                Define how the product should be framed, emphasized, and positioned without altering factual specifications.
              </p>
            </div>

            <div className="p-5 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">
                    What makes this product interesting?
                  </label>
                  <textarea
                    rows={3}
                    value={meta.positioning?.whatMakesItInteresting || ''}
                    onChange={(e) => handleUpdatePositioning('whatMakesItInteresting', e.target.value)}
                    placeholder="Unique craft technique, historical quirk, or rare utility..."
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">
                    Why would someone want it?
                  </label>
                  <textarea
                    rows={3}
                    value={meta.positioning?.whyWouldSomeoneWantIt || ''}
                    onChange={(e) => handleUpdatePositioning('whyWouldSomeoneWantIt', e.target.value)}
                    placeholder="Ritual satisfaction, lifelong durability, tactile presence..."
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">
                    What should the copy EMPHASIZE?
                  </label>
                  <textarea
                    rows={2}
                    value={meta.positioning?.whatToEmphasize || ''}
                    onChange={(e) => handleUpdatePositioning('whatToEmphasize', e.target.value)}
                    placeholder="e.g. Heavy brass patina, hand-stitched welt, bench origin"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">
                    What should the copy AVOID?
                  </label>
                  <textarea
                    rows={2}
                    value={meta.positioning?.whatToAvoid || ''}
                    onChange={(e) => handleUpdatePositioning('whatToAvoid', e.target.value)}
                    placeholder="e.g. Mentioning luxury pricing, fashion trends, or tech buzzwords"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">
                    Key Selling Angle
                  </label>
                  <input
                    type="text"
                    value={meta.positioning?.keySellingAngle || ''}
                    onChange={(e) => handleUpdatePositioning('keySellingAngle', e.target.value)}
                    placeholder="e.g. An unkillable field tool built for decades of hard use"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">
                    Suited Recipient Profile
                  </label>
                  <input
                    type="text"
                    value={meta.positioning?.suitedRecipient || ''}
                    onChange={(e) => handleUpdatePositioning('suitedRecipient', e.target.value)}
                    placeholder="e.g. The quiet perfectionist who cares about screw threading"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">
                    Emotional Angle (Optional)
                  </label>
                  <input
                    type="text"
                    value={meta.positioning?.emotionalAngle || ''}
                    onChange={(e) => handleUpdatePositioning('emotionalAngle', e.target.value)}
                    placeholder="e.g. Nostalgia for field notebooks and tactile paper"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">
                    Historical / Heritage Angle (Optional)
                  </label>
                  <input
                    type="text"
                    value={meta.positioning?.historicalAngle || ''}
                    onChange={(e) => handleUpdatePositioning('historicalAngle', e.target.value)}
                    placeholder="e.g. Rooted in 1920s naval navigational gear"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: COPY FIELDS */}
        {activeTab === 'copy_fields' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6 text-xs">
            <div className="flex items-center justify-between border-b border-[#e5dfd3] pb-3">
              <div>
                <h3 className="font-editorial text-xl font-bold text-[#1e232a]">
                  Dedicated Copy Fields
                </h3>
                <p className="text-xs text-[#736c61] mt-0.5">
                  Generate or refine individual editorial copy components anchored in factual specifications.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleCompileToEditor()}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2d3440] rounded-lg shadow-2xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Assemble into Canvas</span>
              </button>
            </div>

            <div className="space-y-4">
              {/* Headline */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-[#1e232a]">Headline</label>
                  <button
                    type="button"
                    onClick={() => handleGenerateSingleField('headline')}
                    className="text-xs font-semibold text-amber-800 hover:text-amber-950 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-600" />
                    <span>Generate Headline</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={meta.headline || ''}
                  onChange={(e) => handleUpdateMeta('headline', e.target.value)}
                  placeholder="e.g. The Dalvey Voyager: An Heirloom Pocket Compass Built for Life's Journeys"
                  className="w-full p-2 font-editorial text-sm font-semibold rounded border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                />
              </div>

              {/* Standfirst */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-[#1e232a]">Deck / Standfirst</label>
                  <button
                    type="button"
                    onClick={() => handleGenerateSingleField('standfirst')}
                    className="text-xs font-semibold text-amber-800 hover:text-amber-950 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-600" />
                    <span>Generate Standfirst</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={meta.standfirst || ''}
                  onChange={(e) => handleUpdateMeta('standfirst', e.target.value)}
                  placeholder="e.g. Machined Scottish brass instrument with liquid-damped sapphire capsule..."
                  className="w-full p-2 italic text-xs rounded border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                />
              </div>

              {/* Description */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-[#1e232a]">Product Prose Description</label>
                  <button
                    type="button"
                    onClick={() => handleGenerateSingleField('description')}
                    className="text-xs font-semibold text-amber-800 hover:text-amber-950 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-600" />
                    <span>Generate Description</span>
                  </button>
                </div>
                <textarea
                  rows={5}
                  value={meta.description || ''}
                  onChange={(e) => handleUpdateMeta('description', e.target.value)}
                  placeholder="Detailed product prose..."
                  className="w-full p-2 font-editorial text-xs leading-relaxed rounded border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                />
              </div>

              {/* Best For */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-[#1e232a]">Best Suited For</label>
                  <button
                    type="button"
                    onClick={() => handleGenerateSingleField('bestFor')}
                    className="text-xs font-semibold text-amber-800 hover:text-amber-950 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-600" />
                    <span>Generate Best For</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={meta.bestFor || ''}
                  onChange={(e) => handleUpdateMeta('bestFor', e.target.value)}
                  placeholder="e.g. The hiker, cartographer, or desk enthusiast who prizes precision instruments."
                  className="w-full p-2 text-xs rounded border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: MULTI-VARIANTS */}
        {activeTab === 'variants' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6 text-xs">
            <div className="flex items-center justify-between border-b border-[#e5dfd3] pb-3">
              <div>
                <h3 className="font-editorial text-xl font-bold text-[#1e232a]">
                  Multi-Variant Generation Engine
                </h3>
                <p className="text-xs text-[#736c61] mt-0.5">
                  Four distinct editorial styles generated simultaneously from your structured product facts.
                </p>
              </div>

              <button
                type="button"
                disabled={isLoading}
                onClick={handleGenerateVariants}
                className="px-3.5 py-2 text-xs font-bold text-white bg-[#1e232a] hover:bg-[#2d3440] rounded-xl transition-colors inline-flex items-center gap-1.5 shadow-2xs disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" /> : <Wand2 className="w-3.5 h-3.5 text-amber-300" />}
                <span>Generate 4 Style Variants</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Variant 1 */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-2 flex flex-col">
                <div className="flex items-center justify-between border-b border-[#f0ece3] pb-2">
                  <span className="font-bold text-[#1e232a] text-xs">1. Formal Editorial Monograph</span>
                  <button
                    type="button"
                    onClick={() => handleCopyText('formal', meta.variants?.formalEditorial || '')}
                    className="text-[10px] font-semibold text-[#5c5447] hover:text-[#1e232a] inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedVariant === 'formal' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedVariant === 'formal' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <textarea
                  rows={6}
                  value={meta.variants?.formalEditorial || ''}
                  onChange={(e) => handleUpdateVariants('formalEditorial', e.target.value)}
                  placeholder="Click 'Generate 4 Style Variants' to construct formal monograph copy..."
                  className="w-full flex-1 p-2 font-editorial text-xs leading-relaxed rounded border border-[#dcd6ca] bg-[#faf9f6]"
                />
                <button
                  type="button"
                  onClick={() => handleCompileToEditor(meta.variants?.formalEditorial)}
                  className="w-full py-1.5 text-[11px] font-semibold text-[#1e232a] bg-[#f5f2ea] hover:bg-[#ede7db] rounded-lg transition-colors cursor-pointer"
                >
                  Use in Canvas →
                </button>
              </div>

              {/* Variant 2 */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-2 flex flex-col">
                <div className="flex items-center justify-between border-b border-[#f0ece3] pb-2">
                  <span className="font-bold text-[#1e232a] text-xs">2. Emotional Storytelling & Ritual</span>
                  <button
                    type="button"
                    onClick={() => handleCopyText('emotional', meta.variants?.emotionalStorytelling || '')}
                    className="text-[10px] font-semibold text-[#5c5447] hover:text-[#1e232a] inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedVariant === 'emotional' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedVariant === 'emotional' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <textarea
                  rows={6}
                  value={meta.variants?.emotionalStorytelling || ''}
                  onChange={(e) => handleUpdateVariants('emotionalStorytelling', e.target.value)}
                  placeholder="Click 'Generate 4 Style Variants' to construct emotional narrative copy..."
                  className="w-full flex-1 p-2 font-editorial text-xs leading-relaxed rounded border border-[#dcd6ca] bg-[#faf9f6]"
                />
                <button
                  type="button"
                  onClick={() => handleCompileToEditor(meta.variants?.emotionalStorytelling)}
                  className="w-full py-1.5 text-[11px] font-semibold text-[#1e232a] bg-[#f5f2ea] hover:bg-[#ede7db] rounded-lg transition-colors cursor-pointer"
                >
                  Use in Canvas →
                </button>
              </div>

              {/* Variant 3 */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-2 flex flex-col">
                <div className="flex items-center justify-between border-b border-[#f0ece3] pb-2">
                  <span className="font-bold text-[#1e232a] text-xs">3. Concise Conversion Web Copy</span>
                  <button
                    type="button"
                    onClick={() => handleCopyText('concise', meta.variants?.conciseConversion || '')}
                    className="text-[10px] font-semibold text-[#5c5447] hover:text-[#1e232a] inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedVariant === 'concise' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedVariant === 'concise' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <textarea
                  rows={6}
                  value={meta.variants?.conciseConversion || ''}
                  onChange={(e) => handleUpdateVariants('conciseConversion', e.target.value)}
                  placeholder="Click 'Generate 4 Style Variants' to construct concise web copy..."
                  className="w-full flex-1 p-2 font-editorial text-xs leading-relaxed rounded border border-[#dcd6ca] bg-[#faf9f6]"
                />
                <button
                  type="button"
                  onClick={() => handleCompileToEditor(meta.variants?.conciseConversion)}
                  className="w-full py-1.5 text-[11px] font-semibold text-[#1e232a] bg-[#f5f2ea] hover:bg-[#ede7db] rounded-lg transition-colors cursor-pointer"
                >
                  Use in Canvas →
                </button>
              </div>

              {/* Variant 4 */}
              <div className="p-4 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-2 flex flex-col">
                <div className="flex items-center justify-between border-b border-[#f0ece3] pb-2">
                  <span className="font-bold text-[#1e232a] text-xs">4. Technical & Tool Lineage</span>
                  <button
                    type="button"
                    onClick={() => handleCopyText('technical', meta.variants?.technicalHistorical || '')}
                    className="text-[10px] font-semibold text-[#5c5447] hover:text-[#1e232a] inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedVariant === 'technical' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedVariant === 'technical' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <textarea
                  rows={6}
                  value={meta.variants?.technicalHistorical || ''}
                  onChange={(e) => handleUpdateVariants('technicalHistorical', e.target.value)}
                  placeholder="Click 'Generate 4 Style Variants' to construct technical lineage copy..."
                  className="w-full flex-1 p-2 font-editorial text-xs leading-relaxed rounded border border-[#dcd6ca] bg-[#faf9f6]"
                />
                <button
                  type="button"
                  onClick={() => handleCompileToEditor(meta.variants?.technicalHistorical)}
                  className="w-full py-1.5 text-[11px] font-semibold text-[#1e232a] bg-[#f5f2ea] hover:bg-[#ede7db] rounded-lg transition-colors cursor-pointer"
                >
                  Use in Canvas →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: SEO METADATA */}
        {activeTab === 'seo' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6 text-xs">
            <div className="border-b border-[#e5dfd3] pb-3">
              <h3 className="font-editorial text-xl font-bold text-[#1e232a]">
                Product Page SEO Metadata
              </h3>
              <p className="text-xs text-[#736c61] mt-0.5">
                Optimize search title, meta description, and keywords based on your structured product attributes.
              </p>
            </div>

            <div className="p-5 bg-white border border-[#e5dfd3] rounded-xl shadow-2xs space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">SEO Page Title</label>
                  <input
                    type="text"
                    value={meta.seoTitle || ''}
                    onChange={(e) => handleUpdateMeta('seoTitle', e.target.value)}
                    placeholder="e.g. Dalvey Voyager Pocket Compass | Science of Gifts"
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#5c5447] mb-1">Meta Description</label>
                  <textarea
                    rows={3}
                    value={meta.metaDescription || ''}
                    onChange={(e) => handleUpdateMeta('metaDescription', e.target.value)}
                    placeholder="e.g. Discover the Dalvey Voyager pocket compass. Machined from solid Scottish brass with liquid-damped sapphire capsule..."
                    className="w-full p-2 rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-[#5c5447] mb-1">URL Slug</label>
                    <input
                      type="text"
                      value={meta.slug || ''}
                      onChange={(e) => handleUpdateMeta('slug', e.target.value)}
                      placeholder="e.g. dalvey-voyager-pocket-compass"
                      className="w-full p-2 font-mono text-xs rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#5c5447] mb-1">Primary Target Keyword</label>
                    <input
                      type="text"
                      value={meta.primaryKeyword || ''}
                      onChange={(e) => handleUpdateMeta('primaryKeyword', e.target.value)}
                      placeholder="e.g. brass pocket compass"
                      className="w-full p-2 text-xs rounded-md border border-[#dcd6ca] bg-[#faf8f4] focus:bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
