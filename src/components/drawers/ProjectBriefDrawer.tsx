/**
 * Science of Gifts - Project Brief Drawer (Requirement #27)
 * Defines WHAT the piece aims to accomplish (distinct from HOW to write).
 */

import React, { useState } from 'react';
import { ProjectBrief } from '../../types/project';
import { Compass, X, Plus, Trash2, HelpCircle } from 'lucide-react';

interface ProjectBriefDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  brief: ProjectBrief;
  onChange: (updatedBrief: ProjectBrief) => void;
  onOpenDevelop?: () => void;
}

export const ProjectBriefDrawer: React.FC<ProjectBriefDrawerProps> = ({
  isOpen,
  onClose,
  brief,
  onChange,
  onOpenDevelop,
}) => {
  const [newKeyPoint, setNewKeyPoint] = useState('');
  const [newAvoidItem, setNewAvoidItem] = useState('');

  if (!isOpen) return null;

  const handleFieldChange = (field: keyof ProjectBrief, value: any) => {
    onChange({
      ...brief,
      [field]: value,
    });
  };

  const handleAddKeyPoint = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyPoint.trim()) return;
    onChange({
      ...brief,
      keyPoints: [...(brief.keyPoints || []), newKeyPoint.trim()],
    });
    setNewKeyPoint('');
  };

  const handleRemoveKeyPoint = (index: number) => {
    onChange({
      ...brief,
      keyPoints: (brief.keyPoints || []).filter((_, i) => i !== index),
    });
  };

  const handleAddAvoidItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAvoidItem.trim()) return;
    onChange({
      ...brief,
      thingsToAvoid: [...(brief.thingsToAvoid || []), newAvoidItem.trim()],
    });
    setNewAvoidItem('');
  };

  const handleRemoveAvoidItem = (index: number) => {
    onChange({
      ...brief,
      thingsToAvoid: (brief.thingsToAvoid || []).filter((_, i) => i !== index),
    });
  };

  return (
    <div className="max-md:fixed max-md:inset-0 max-md:z-50 max-md:w-full w-full md:w-[440px] lg:w-[480px] shrink-0 h-full bg-[#faf9f6] md:border-l border-[#dcd6ca] flex flex-col overflow-hidden animate-in slide-in-from-right-1 duration-150 z-30">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-[#e5dfd3] bg-[#f5f2ea] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-800 shrink-0">
            <Compass className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-editorial text-lg font-semibold text-[#1e232a] truncate">Project Brief</h3>
            <p className="text-xs text-[#736c61] truncate">Defines what this piece is trying to accomplish</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[#736c61] hover:text-[#2d333b] rounded-lg hover:bg-[#e8e2d5] transition-colors shrink-0"
          title="Close Project Brief"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Notice */}
      <div className="px-5 py-2.5 bg-blue-50/60 border-b border-blue-200/50 flex items-start gap-2 text-xs text-blue-900">
        <HelpCircle className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
        <span>
          Instructions tell the AI <em>how</em> to write. The Brief tells the AI <em>what</em> this piece must accomplish.
        </span>
      </div>

      {/* Editorial Development Workflow Link */}
      {onOpenDevelop && (
        <div className="px-5 py-2 bg-amber-50/70 border-b border-amber-200/60 flex items-center justify-between gap-2 text-xs">
          <span className="text-amber-950">
            Developing from an idea? Explore 5 angles and synthesize this brief.
          </span>
          <button
            type="button"
            onClick={onOpenDevelop}
            className="text-[11px] font-bold text-amber-900 hover:text-amber-950 underline shrink-0 cursor-pointer"
          >
            Open Develop →
          </button>
        </div>
      )}

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
        {/* Purpose */}
        <div>
          <label className="block text-xs font-semibold text-[#443d34] uppercase tracking-wider mb-1.5">
            Core Editorial Purpose
          </label>
          <textarea
            rows={2}
            value={brief.purpose}
            onChange={(e) => handleFieldChange('purpose', e.target.value)}
            placeholder="e.g. Provide a discerning guide to heirloom timepieces without commercial hype..."
            className="w-full px-3 py-2 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500 text-[#1e232a]"
          />
        </div>

        {/* Audience */}
        <div>
          <label className="block text-xs font-semibold text-[#443d34] uppercase tracking-wider mb-1.5">
            Target Audience
          </label>
          <input
            type="text"
            value={brief.audience}
            onChange={(e) => handleFieldChange('audience', e.target.value)}
            placeholder="e.g. Thoughtful gifters who appreciate analog craft and material longevity"
            className="w-full px-3 py-2 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500 text-[#1e232a]"
          />
        </div>

        {/* Reader Objectives Grid */}
        <div className="grid grid-cols-1 gap-3.5 pt-2 border-t border-[#e8e2d5]">
          <div>
            <label className="block text-xs font-medium text-[#4a443b] mb-1">
              What the reader should learn:
            </label>
            <input
              type="text"
              value={brief.readerLearns}
              onChange={(e) => handleFieldChange('readerLearns', e.target.value)}
              placeholder="e.g. The difference between mass novelty and serviceable mechanical calibers"
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#4a443b] mb-1">
              What the reader should feel:
            </label>
            <input
              type="text"
              value={brief.readerFeels}
              onChange={(e) => handleFieldChange('readerFeels', e.target.value)}
              placeholder="e.g. Confident, enlightened, and reassured in choosing an heirloom"
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#4a443b] mb-1">
              What the reader should do after reading:
            </label>
            <input
              type="text"
              value={brief.readerAction}
              onChange={(e) => handleFieldChange('readerAction', e.target.value)}
              placeholder="e.g. Gift with quiet conviction rather than panic-buying a gadget"
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Key Points to Cover */}
        <div className="pt-2 border-t border-[#e8e2d5]">
          <label className="block text-xs font-semibold text-[#443d34] uppercase tracking-wider mb-2">
            Important Points to Cover
          </label>
          <div className="space-y-1.5 mb-2.5">
            {(brief.keyPoints || []).map((point, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-3 py-1.5 bg-white border border-[#e5dfd3] rounded-md text-xs text-[#2d333b]"
              >
                <span>• {point}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveKeyPoint(idx)}
                  className="text-stone-400 hover:text-rose-600 transition-colors ml-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <form onSubmit={handleAddKeyPoint} className="flex gap-2">
            <input
              type="text"
              value={newKeyPoint}
              onChange={(e) => setNewKeyPoint(e.target.value)}
              placeholder="Add key point..."
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs bg-[#1e232a] text-white rounded-lg hover:bg-[#2d333b] transition-colors inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </form>
        </div>

        {/* Things to Avoid */}
        <div className="pt-2 border-t border-[#e8e2d5]">
          <label className="block text-xs font-semibold text-rose-900 uppercase tracking-wider mb-2">
            Things to Avoid (Hard Taboos)
          </label>
          <div className="space-y-1.5 mb-2.5">
            {(brief.thingsToAvoid || []).map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-3 py-1.5 bg-rose-50/50 border border-rose-200/60 rounded-md text-xs text-rose-950"
              >
                <span>✕ {item}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAvoidItem(idx)}
                  className="text-rose-400 hover:text-rose-700 transition-colors ml-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <form onSubmit={handleAddAvoidItem} className="flex gap-2">
            <input
              type="text"
              value={newAvoidItem}
              onChange={(e) => setNewAvoidItem(e.target.value)}
              placeholder="e.g. Amazon listicle tone, spec dumps..."
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-[#dcd6ca] bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs bg-rose-800 text-white rounded-lg hover:bg-rose-900 transition-colors inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </form>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[#e5dfd3] bg-[#f5f2ea] flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-1.5 text-xs font-medium text-[#1e232a] bg-white border border-[#dcd6ca] rounded-lg hover:bg-[#eae4d7]"
        >
          Done
        </button>
      </div>
    </div>
  );
};
