/**
 * Science of Gifts - Editorial Idea Generator View (Phase 10.5 & Saved Ideas Enhancement)
 * Uncovers high-intent article concepts and provides a persistent personal shelf of saved ideas.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Lightbulb,
  Sparkles,
  ArrowRight,
  Copy,
  Check,
  RotateCw,
  Loader2,
  AlertCircle,
  Cpu,
  ChevronDown,
  Compass,
  Bookmark,
  BookmarkCheck,
  Trash2,
  Search,
  Calendar,
  Layers,
} from 'lucide-react';
import {
  EditorialIdea,
  SavedEditorialIdea,
  IdeaGoal,
  IdeaStyle,
  IdeaGenerationRequest,
} from '../types/ideaGenerator';
import { geminiService } from '../services/geminiClient';
import { ModelId } from '../types/models';
import { storage } from '../services/storage';
import { toast } from '../services/toastService';
import { ConfirmationModal } from './ConfirmationModal';

interface IdeaGeneratorViewProps {
  onUseIdea: (idea: EditorialIdea, audience?: string) => void;
  onBackToStudio: () => void;
}

const GOAL_OPTIONS: IdeaGoal[] = [
  'Informational',
  'Problem-solving',
  'Gift-related',
  'Psychological',
  'Cultural',
  'Practical',
  'Search-focused',
];

const STYLE_OPTIONS: IdeaStyle[] = [
  'Unexpected',
  'Psychological',
  'Contrarian',
  'Practical',
  'Deep dive',
  'Cultural',
  'Specific problem',
  'Mixed',
];

const SUGGESTED_TOPICS = [
  'WWII gifts',
  'Fountain pens for non-writers',
  'Why practical gifts backfire',
  'Restoring vintage cast iron',
  'Gifts for solitary readers',
];

export const IdeaGeneratorView: React.FC<IdeaGeneratorViewProps> = ({
  onUseIdea,
  onBackToStudio,
}) => {
  // Tab State
  const [activeTab, setActiveTab] = useState<'generate' | 'saved'>('generate');

  // Form State
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState<IdeaGoal>('Informational');
  const [ideaStyle, setIdeaStyle] = useState<IdeaStyle>('Unexpected');
  const [context, setContext] = useState('');
  const [avoidObvious, setAvoidObvious] = useState(true);

  // Model Selection (Recommended: Gemini 3.6 Flash)
  const [selectedModel, setSelectedModel] = useState<ModelId>('gemini-3.6-flash');

  // Generation & Results State
  const [isGenerating, setIsGenerating] = useState(false);
  const [ideas, setIdeas] = useState<EditorialIdea[]>([]);
  const [lastGeneratedTopic, setLastGeneratedTopic] = useState('');
  const [lastModelUsed, setLastModelUsed] = useState<string>('');
  const [lastDurationMs, setLastDurationMs] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up pending copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Saved Ideas State
  const [savedIdeas, setSavedIdeas] = useState<SavedEditorialIdea[]>(() => storage.getSavedIdeas());
  const [savedSearchQuery, setSavedSearchQuery] = useState('');
  const [deletingIdeaId, setDeletingIdeaId] = useState<string | null>(null);

  // Refresh saved ideas whenever this view opens or updates
  useEffect(() => {
    setSavedIdeas(storage.getSavedIdeas());
  }, []);

  // Quick lookup of saved idea titles/angles
  const isIdeaSaved = (title: string, angle: string): boolean => {
    const normalize = (s: string) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    return savedIdeas.some(
      (saved) =>
        normalize(saved.title) === normalize(title) &&
        normalize(saved.angle) === normalize(angle)
    );
  };

  // Handle generation request (Consumes explicit Gemini AI call)
  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!topic.trim() || isGenerating) return;

    setError(null);
    setIsGenerating(true);

    try {
      const request: IdeaGenerationRequest = {
        topic: topic.trim(),
        audience: audience.trim() || undefined,
        goal,
        ideaStyle,
        context: context.trim() || undefined,
        avoidObvious,
      };

      const res = await geminiService.generateIdeas(request, {
        modelOverride: selectedModel,
      });

      if (res.ok && res.ideas.length > 0) {
        setIdeas(res.ideas);
        setLastGeneratedTopic(topic.trim());
        setLastModelUsed(res.modelUsed);
        setLastDurationMs(res.durationMs);
        toast.success(
          'Editorial Ideas Generated',
          `Crafted ${res.ideas.length} distinctive angles for "${topic.trim()}".`
        );
      } else {
        setError(res.error || 'Could not generate ideas. Try again or choose another model.');
        toast.error('Generation Failed', res.error || 'Could not generate ideas. Try again.');
      }
    } catch (err: any) {
      console.error('Error generating editorial ideas:', err);
      setError('Could not generate ideas. Try again or choose another model.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Save generated idea (Zero AI usage, instant local persistence)
  const handleSaveIdea = (idea: EditorialIdea) => {
    if (isIdeaSaved(idea.title, idea.angle)) {
      toast.info('Already saved', `"${idea.title}" is already in your Saved Ideas.`);
      return;
    }

    const newSaved: SavedEditorialIdea = {
      id: `saved-idea-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: idea.title,
      angle: idea.angle,
      whyInteresting: idea.whyInteresting,
      searchIntent: idea.searchIntent,
      originalTopic: lastGeneratedTopic || topic.trim() || 'General Editorial',
      audience: audience.trim() || undefined,
      goal,
      ideaStyle,
      savedAt: new Date().toISOString(),
    };

    const success = storage.saveSavedIdea(newSaved);
    if (success) {
      setSavedIdeas(storage.getSavedIdeas());
      toast.success('Idea Saved', `"${idea.title}" saved to your collection.`);
    } else {
      toast.info('Already saved', 'This idea is already in your Saved Ideas.');
    }
  };

  // Delete saved idea with safety confirmation
  const handleConfirmDelete = () => {
    if (!deletingIdeaId) return;
    const target = savedIdeas.find((i) => i.id === deletingIdeaId);
    storage.deleteSavedIdea(deletingIdeaId);
    setSavedIdeas(storage.getSavedIdeas());
    setDeletingIdeaId(null);
    toast.info('Idea Removed', `"${target?.title || 'Idea'}" removed from Saved Ideas.`);
  };

  // Copy idea to clipboard
  const handleCopyIdea = (idea: { title: string; angle: string; whyInteresting: string; searchIntent?: string }) => {
    const textToCopy = `TITLE: ${idea.title}\n\nANGLE:\n${idea.angle}\n\nWHY IT'S INTERESTING:\n${idea.whyInteresting}${
      idea.searchIntent ? `\n\nSEARCH INTENT: ${idea.searchIntent}` : ''
    }`;

    navigator.clipboard.writeText(textToCopy);
    setCopiedId((idea as any).id);
    toast.info('Copied to Clipboard', `"${idea.title}" copied.`);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  // Format date helper
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Filtered saved ideas based on search input
  const filteredSavedIdeas = useMemo(() => {
    const q = savedSearchQuery.toLowerCase().trim();
    if (!q) return savedIdeas;
    return savedIdeas.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.originalTopic.toLowerCase().includes(q) ||
        item.angle.toLowerCase().includes(q) ||
        (item.whyInteresting && item.whyInteresting.toLowerCase().includes(q))
    );
  }, [savedIdeas, savedSearchQuery]);

  const ideaToDelete = deletingIdeaId
    ? savedIdeas.find((i) => i.id === deletingIdeaId)
    : null;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#faf9f6]">
      {/* Confirmation Modal for Safe Deletion */}
      <ConfirmationModal
        isOpen={Boolean(deletingIdeaId)}
        title="Remove Saved Idea?"
        message={`Are you sure you want to remove "${ideaToDelete?.title || 'this idea'}" from your saved collection? Any Article projects created from this idea will remain completely untouched.`}
        confirmLabel="Remove Idea"
        cancelLabel="Keep Idea"
        isDestructive={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingIdeaId(null)}
      />

      {/* Top Editorial Header & Destination Tabs */}
      <div className="bg-[#f6f3eb] border-b border-[#e5dfd3] px-6 py-6 md:px-12 md:py-8">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
              <Lightbulb className="w-4 h-4 text-amber-700" />
              <span>Editorial Planning Desk</span>
            </div>

            {/* Back button */}
            <button
              type="button"
              onClick={onBackToStudio}
              className="text-xs text-[#736c61] hover:text-[#1e232a] transition-colors"
            >
              Back to Studio
            </button>
          </div>

          <div>
            <h1 className="font-editorial text-3xl md:text-4xl font-bold tracking-tight text-[#1e232a]">
              Idea Generator
            </h1>
            <p className="text-sm md:text-base text-[#615a50] mt-1 leading-relaxed">
              Find interesting article ideas, questions, and angles worth exploring.
            </p>
          </div>

          {/* Sub-Tabs: Generate Ideas vs Saved Ideas */}
          <div className="flex items-center gap-2 pt-2 border-t border-[#ded7ca]">
            <button
              type="button"
              onClick={() => setActiveTab('generate')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors select-none ${
                activeTab === 'generate'
                  ? 'bg-[#1e232a] text-white shadow-2xs'
                  : 'bg-white/70 text-[#5c5447] hover:bg-white hover:text-[#1e232a] border border-[#dcd6ca]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate Ideas</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('saved')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors select-none ${
                activeTab === 'saved'
                  ? 'bg-[#1e232a] text-white shadow-2xs'
                  : 'bg-white/70 text-[#5c5447] hover:bg-white hover:text-[#1e232a] border border-[#dcd6ca]'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Saved Ideas</span>
              {savedIdeas.length > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                    activeTab === 'saved'
                      ? 'bg-white/20 text-white'
                      : 'bg-[#ede8dc] text-[#5c5447]'
                  }`}
                >
                  {savedIdeas.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Workspace */}
      <div className="max-w-4xl mx-auto w-full px-3 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-10 flex-1">
        {/* ========================================================================= */}
        {/* TAB 1: GENERATE IDEAS                                                     */}
        {/* ========================================================================= */}
        {activeTab === 'generate' && (
          <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-150">
            {/* Form Controls Card */}
            <section
              aria-label="Idea Generator Configuration"
              className="bg-white rounded-2xl border border-[#ded7ca] p-4 sm:p-6 md:p-8 shadow-2xs space-y-5 sm:space-y-6"
            >
              <form onSubmit={handleGenerate} className="space-y-6">
                {/* Primary Topic Input (Required) */}
                <div className="space-y-2">
                  <label htmlFor="topic-input" className="block text-xs font-bold uppercase tracking-wider text-[#4a443b]">
                    Topic <span className="text-amber-800">*</span>
                  </label>
                  <input
                    id="topic-input"
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g., WWII gifts, mechanical field watches, vintage cast iron"
                    required
                    className="w-full px-4 py-3 bg-[#faf9f6] border border-[#dcd6ca] rounded-xl text-base text-[#1e232a] placeholder:text-[#9e9689] focus:outline-hidden focus:border-amber-600 focus:bg-white transition-colors"
                  />

                  {/* Sample Topic Suggestions */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-[#8a8275] mr-1">Suggestions:</span>
                    {SUGGESTED_TOPICS.map((suggested) => (
                      <button
                        key={suggested}
                        type="button"
                        onClick={() => setTopic(suggested)}
                        className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#f6f3eb] hover:bg-[#ede8dc] text-[#5c5447] border border-[#e5dfd3] transition-colors"
                      >
                        {suggested}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Fields Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                  {/* Audience */}
                  <div className="space-y-1.5">
                    <label htmlFor="audience-input" className="block text-xs font-semibold text-[#5c5447]">
                      Audience <span className="text-xs font-normal text-[#8c8477]">(Optional)</span>
                    </label>
                    <input
                      id="audience-input"
                      type="text"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      placeholder="e.g., Historians, adult siblings"
                      className="w-full px-3 py-2 bg-[#faf9f6] border border-[#dcd6ca] rounded-lg text-sm text-[#1e232a] placeholder:text-[#9e9689] focus:outline-hidden focus:border-amber-600 focus:bg-white"
                    />
                  </div>

                  {/* Goal */}
                  <div className="space-y-1.5">
                    <label htmlFor="goal-select" className="block text-xs font-semibold text-[#5c5447]">
                      Goal
                    </label>
                    <div className="relative">
                      <select
                        id="goal-select"
                        value={goal}
                        onChange={(e) => setGoal(e.target.value as IdeaGoal)}
                        className="w-full px-3 py-2 bg-[#faf9f6] border border-[#dcd6ca] rounded-lg text-sm text-[#1e232a] appearance-none pr-8 cursor-pointer focus:outline-hidden focus:border-amber-600 focus:bg-white"
                      >
                        {GOAL_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-[#8c8477] absolute right-2.5 top-3 pointer-events-none" />
                    </div>
                  </div>

                  {/* Idea Style */}
                  <div className="space-y-1.5">
                    <label htmlFor="style-select" className="block text-xs font-semibold text-[#5c5447]">
                      Idea Style
                    </label>
                    <div className="relative">
                      <select
                        id="style-select"
                        value={ideaStyle}
                        onChange={(e) => setIdeaStyle(e.target.value as IdeaStyle)}
                        className="w-full px-3 py-2 bg-[#faf9f6] border border-[#dcd6ca] rounded-lg text-sm text-[#1e232a] appearance-none pr-8 cursor-pointer focus:outline-hidden focus:border-amber-600 focus:bg-white"
                      >
                        {STYLE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-[#8c8477] absolute right-2.5 top-3 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Optional Context */}
                <div className="space-y-1.5">
                  <label htmlFor="context-input" className="block text-xs font-semibold text-[#5c5447]">
                    Optional Context
                  </label>
                  <textarea
                    id="context-input"
                    rows={2}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="What I want to explore... (e.g., focus on why surface decoration feels cheap compared to period documents)"
                    className="w-full px-3 py-2 bg-[#faf9f6] border border-[#dcd6ca] rounded-lg text-sm text-[#1e232a] placeholder:text-[#9e9689] focus:outline-hidden focus:border-amber-600 focus:bg-white resize-none"
                  />
                </div>

                {/* Controls Bar: Toggle & Model Management */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-[#f0ede6]">
                  {/* Avoid Obvious Ideas Toggle */}
                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={avoidObvious}
                      onChange={(e) => setAvoidObvious(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded-sm border-[#dcd6ca] text-amber-700 focus:ring-amber-500 cursor-pointer"
                    />
                    <div>
                      <div className="text-xs font-semibold text-[#2b251d]">Avoid obvious ideas</div>
                      <div className="text-[11px] text-[#736c61]">
                        Filters out generic listicles, obvious keyword variants, and repetitive formulas
                      </div>
                    </div>
                  </label>

                  {/* Model Picker */}
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <div className="text-[11px] text-[#736c61]">Model:</div>
                    <div className="relative">
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value as ModelId)}
                        className="text-xs font-medium py-1 px-2.5 bg-[#f6f3eb] hover:bg-[#ede8dc] border border-[#dcd6ca] rounded-md text-[#2b251d] cursor-pointer focus:outline-hidden"
                      >
                        <option value="gemini-3.6-flash">
                          Gemini 3.6 Flash (Recommended)
                        </option>
                        <option value="gemini-3.8-flash">
                          Gemini 3.8 Flash (Flagship)
                        </option>
                        <option value="gemini-3.7-flash">
                          Gemini 3.7 Flash (Reasoning)
                        </option>
                        <option value="gemini-3.5-flash">
                          Gemini 3.5 Flash (Fast)
                        </option>
                        <option value="gemini-3.5-flash-lite">
                          Gemini 3.5 Flash Lite
                        </option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Action Bar */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-[#8a8275]">
                    {topic.trim() ? (
                      <span>Ready to discover unhurried angles</span>
                    ) : (
                      <span>Enter a topic to generate editorial ideas</span>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={!topic.trim() || isGenerating}
                    className="w-full sm:w-auto px-6 py-2.5 bg-[#1e232a] hover:bg-[#2d3744] disabled:bg-[#dcd6ca] disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-all shadow-xs inline-flex items-center justify-center gap-2 select-none min-h-[44px]"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                        <span>Generating ideas...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-amber-300" />
                        <span>Generate Ideas</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </section>

            {/* Error Notification */}
            {error && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 flex items-start gap-3 text-sm animate-in fade-in">
                <AlertCircle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold">Generation Error</div>
                  <div className="text-xs text-rose-800 mt-0.5">{error}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerate()}
                  className="text-xs font-semibold px-3 py-1 bg-white border border-rose-300 hover:bg-rose-100 rounded-md text-rose-900 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Generated Results Section */}
            {ideas.length > 0 && (
              <section aria-label="Generated Editorial Ideas" className="space-y-6 animate-in fade-in duration-200">
                {/* Results Header / Summary Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#ded7ca]">
                  <div>
                    <h2 className="font-editorial text-2xl font-bold text-[#1e232a]">
                      Editorial Ideas for &ldquo;{lastGeneratedTopic}&rdquo;
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-[#736c61] mt-0.5">
                      <span>{ideas.length} ideas formulated</span>
                      {lastModelUsed && (
                        <>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5c5447]">
                            <Cpu className="w-3 h-3 text-indigo-700" />
                            {lastModelUsed}
                          </span>
                        </>
                      )}
                      {lastDurationMs && (
                        <>
                          <span>•</span>
                          <span>{(lastDurationMs / 1000).toFixed(2)}s</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Regenerate Action */}
                  <button
                    type="button"
                    onClick={() => handleGenerate()}
                    disabled={isGenerating}
                    className="px-3.5 py-1.5 text-xs font-semibold text-[#2b251d] hover:text-[#1e232a] bg-[#ede8dc] hover:bg-[#e2dcce] rounded-lg transition-colors inline-flex items-center gap-1.5 self-start sm:self-auto select-none"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                    <span>Regenerate Ideas</span>
                  </button>
                </div>

                {/* Editorial Ideas List */}
                <div className="divide-y divide-[#e5dfd3]">
                  {ideas.map((idea, index) => {
                    const saved = isIdeaSaved(idea.title, idea.angle);

                    return (
                      <article
                        key={idea.id}
                        className="py-6 first:pt-2 last:pb-4 space-y-3.5 group transition-colors hover:bg-white/40 -mx-3 px-3 rounded-xl"
                      >
                        {/* Top Bar: Number & Intent Badge */}
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-mono font-bold text-[#a8a194]">
                            {String(index + 1).padStart(2, '0')}
                          </span>

                          {idea.searchIntent && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#f6f3eb] text-[#615a50] border border-[#e5dfd3]">
                              {idea.searchIntent}
                            </span>
                          )}
                        </div>

                        {/* Title (Prominent Newsreader Editorial Font) */}
                        <h3 className="font-editorial text-xl md:text-2xl font-bold text-[#1e232a] leading-snug group-hover:text-amber-950 transition-colors">
                          {idea.title}
                        </h3>

                        {/* Angle */}
                        <div className="space-y-1">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-[#787166]">
                            Editorial Angle:
                          </div>
                          <p className="text-sm text-[#2b251d] leading-relaxed">
                            {idea.angle}
                          </p>
                        </div>

                        {/* Why It's Interesting */}
                        <div className="space-y-1 pt-0.5">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-[#8a8275]">
                            Why It&rsquo;s Interesting:
                          </div>
                          <p className="text-xs md:text-sm text-[#615a50] leading-relaxed">
                            {idea.whyInteresting}
                          </p>
                        </div>

                        {/* Action Buttons: Save, Copy, Use This Idea */}
                        <div className="pt-2 flex flex-wrap items-center justify-between gap-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Save / Saved Button */}
                            {saved ? (
                              <button
                                type="button"
                                onClick={() =>
                                  toast.info('Already saved', 'This idea is already in your Saved Ideas.')
                                }
                                className="px-3 py-1.5 min-h-[36px] text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors inline-flex items-center gap-1.5 select-none"
                                title="Idea already saved in your collection"
                              >
                                <BookmarkCheck className="w-3.5 h-3.5 text-amber-700" />
                                <span>Saved</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSaveIdea(idea)}
                                className="px-3 py-1.5 min-h-[36px] text-xs font-medium text-[#5c5447] hover:text-[#1e232a] bg-[#f6f3eb] hover:bg-[#ede8dc] border border-[#dcd6ca] rounded-lg transition-colors inline-flex items-center gap-1.5 select-none"
                                title="Save idea for later"
                              >
                                <Bookmark className="w-3.5 h-3.5 text-[#736c61]" />
                                <span>Save</span>
                              </button>
                            )}

                            {/* Copy Action */}
                            <button
                              type="button"
                              onClick={() => handleCopyIdea(idea)}
                              className="px-3 py-1.5 min-h-[36px] text-xs font-medium text-[#5c5447] hover:text-[#1e232a] bg-[#f6f3eb] hover:bg-[#ede8dc] border border-[#dcd6ca] rounded-lg transition-colors inline-flex items-center gap-1.5 select-none"
                              title="Copy idea details to clipboard"
                            >
                              {copiedId === idea.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                                  <span className="text-emerald-800 font-semibold">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-[#736c61]" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>

                          {/* Primary "Use This Idea" Action */}
                          <button
                            type="button"
                            onClick={() => onUseIdea(idea, audience)}
                            className="px-4 py-1.5 min-h-[36px] text-xs font-semibold text-white bg-[#1e232a] hover:bg-amber-900 rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-2xs select-none"
                          >
                            <span>Use This Idea</span>
                            <ArrowRight className="w-3.5 h-3.5 text-amber-300" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Clean Empty State when no ideas yet */}
            {ideas.length === 0 && !isGenerating && !error && (
              <div className="py-12 px-6 rounded-2xl border border-dashed border-[#ded7ca] text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#ede8dc] text-[#5c5447] flex items-center justify-center mx-auto">
                  <Compass className="w-6 h-6 text-amber-800" />
                </div>
                <div className="font-editorial text-xl font-bold text-[#1e232a]">
                  Discover Fresh Editorial Perspectives
                </div>
                <p className="text-xs md:text-sm text-[#736c61] max-w-md mx-auto leading-relaxed">
                  Enter any subject or gifting question above to explore 8 to 12 unhurried angles, recipient psychology, and authentic dilemmas.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: SAVED IDEAS (Persistent Shelf)                                     */}
        {/* ========================================================================= */}
        {activeTab === 'saved' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* Search & Counter Strip */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#ded7ca]">
              <div>
                <h2 className="font-editorial text-2xl font-bold text-[#1e232a]">
                  Saved Ideas
                </h2>
                <p className="text-xs text-[#736c61] mt-0.5">
                  {savedIdeas.length} {savedIdeas.length === 1 ? 'idea' : 'ideas'} saved for future writing sessions
                </p>
              </div>

              {/* Simple Search Input */}
              {savedIdeas.length > 0 && (
                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-[#8c8477] absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={savedSearchQuery}
                    onChange={(e) => setSavedSearchQuery(e.target.value)}
                    placeholder="Search saved ideas..."
                    className="w-full text-xs pl-8 pr-3 py-2 bg-white border border-[#dcd6ca] rounded-lg text-[#1e232a] placeholder:text-[#9e9689] focus:outline-hidden focus:border-amber-600"
                  />
                </div>
              )}
            </div>

            {/* Saved Ideas List */}
            {filteredSavedIdeas.length > 0 ? (
              <div className="divide-y divide-[#e5dfd3]">
                {filteredSavedIdeas.map((saved, index) => (
                  <article
                    key={saved.id}
                    className="py-6 first:pt-2 last:pb-4 space-y-3.5 group transition-colors hover:bg-white/40 -mx-3 px-3 rounded-xl"
                  >
                    {/* Header Strip: Topic Pill, Metadata, Date */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md font-semibold text-[11px] bg-amber-100/80 text-amber-950 border border-amber-200">
                          Topic: {saved.originalTopic}
                        </span>

                        {saved.searchIntent && (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#f6f3eb] text-[#615a50] border border-[#e5dfd3]">
                            {saved.searchIntent}
                          </span>
                        )}

                        {saved.audience && (
                          <span className="text-[11px] text-[#736c61]">
                            Audience: {saved.audience}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-[#8c8477]">
                        <Calendar className="w-3 h-3" />
                        <span>{formatDate(saved.savedAt)}</span>
                      </div>
                    </div>

                    {/* Title */}
                    <h3 className="font-editorial text-xl md:text-2xl font-bold text-[#1e232a] leading-snug group-hover:text-amber-950 transition-colors">
                      {saved.title}
                    </h3>

                    {/* Angle */}
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#787166]">
                        Editorial Angle:
                      </div>
                      <p className="text-sm text-[#2b251d] leading-relaxed">
                        {saved.angle}
                      </p>
                    </div>

                    {/* Why It's Interesting */}
                    <div className="space-y-1 pt-0.5">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#8a8275]">
                        Why It&rsquo;s Interesting:
                      </div>
                      <p className="text-xs md:text-sm text-[#615a50] leading-relaxed">
                        {saved.whyInteresting}
                      </p>
                    </div>

                    {/* Actions: Copy, Delete, Use This Idea */}
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Copy */}
                        <button
                          type="button"
                          onClick={() => handleCopyIdea(saved)}
                          className="px-3 py-1.5 min-h-[36px] text-xs font-medium text-[#5c5447] hover:text-[#1e232a] bg-[#f6f3eb] hover:bg-[#ede8dc] border border-[#dcd6ca] rounded-lg transition-colors inline-flex items-center gap-1.5 select-none"
                          title="Copy idea details to clipboard"
                        >
                          {copiedId === saved.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-700" />
                              <span className="text-emerald-800 font-semibold">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[#736c61]" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        {/* Delete action */}
                        <button
                          type="button"
                          onClick={() => setDeletingIdeaId(saved.id)}
                          className="px-3 py-1.5 min-h-[36px] text-xs font-medium text-rose-800 hover:text-rose-950 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-lg transition-colors inline-flex items-center gap-1.5 select-none"
                          title="Remove this idea from saved collection"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>

                      {/* Use This Idea (Creates new article without deleting the saved idea) */}
                      <button
                        type="button"
                        onClick={() =>
                          onUseIdea(
                            {
                              id: saved.id,
                              title: saved.title,
                              angle: saved.angle,
                              whyInteresting: saved.whyInteresting,
                              searchIntent: saved.searchIntent,
                            },
                            saved.audience
                          )
                        }
                        className="px-4 py-1.5 min-h-[36px] text-xs font-semibold text-white bg-[#1e232a] hover:bg-amber-900 rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-2xs select-none"
                        title="Create new Article draft from this idea"
                      >
                        <span>Use This Idea</span>
                        <ArrowRight className="w-3.5 h-3.5 text-amber-300" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : savedIdeas.length === 0 ? (
              /* Completely Empty State */
              <div className="py-16 px-6 rounded-2xl border border-dashed border-[#ded7ca] text-center space-y-4 bg-white/50">
                <div className="w-12 h-12 rounded-2xl bg-[#ede8dc] text-[#5c5447] flex items-center justify-center mx-auto">
                  <Bookmark className="w-6 h-6 text-amber-800" />
                </div>
                <div className="space-y-1">
                  <div className="font-editorial text-xl font-bold text-[#1e232a]">
                    No Saved Ideas Yet
                  </div>
                  <p className="text-xs md:text-sm text-[#736c61] max-w-md mx-auto leading-relaxed">
                    When generating article concepts, click the <span className="font-semibold text-[#1e232a]">Save</span> button on any idea to bookmark it here for future writing sessions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('generate')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#1e232a] hover:bg-[#2d3744] rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-xs select-none"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Start Generating Ideas</span>
                </button>
              </div>
            ) : (
              /* Search Empty State */
              <div className="py-12 px-6 rounded-xl border border-dashed border-[#ded7ca] text-center space-y-2">
                <div className="text-sm font-semibold text-[#1e232a]">
                  No ideas match &ldquo;{savedSearchQuery}&rdquo;
                </div>
                <p className="text-xs text-[#736c61]">
                  Try searching by a different keyword, title, or topic.
                </p>
                <button
                  type="button"
                  onClick={() => setSavedSearchQuery('')}
                  className="text-xs font-semibold text-amber-900 underline mt-2"
                >
                  Clear search query
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
