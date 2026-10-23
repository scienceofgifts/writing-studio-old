/**
 * Science of Gifts - Storage Service
 * LocalStorage persistence, seed projects, and global instructions
 * Stores structured rich-text content for modern CMS publishing.
 */

import {
  WritingProject,
  ProjectType,
  ProjectStatus,
  GlobalInstruction,
  WritingControls,
  AISettings,
  ProjectBrief,
  ContentRule,
  OutlineItem
} from '../types/project';
import { StyleProfile } from '../types/styleReference';
import { InternalLink } from '../types/internalLink';
import { inferDestinationType } from '../utils/urlUtils';
import {
  GiftGuideMetadata,
  DEFAULT_GIFT_GUIDE_METADATA,
  DEFAULT_GUIDE_SETTINGS,
} from '../types/giftGuide';
import { ThemeId } from '../theme/tokens';
import { ensureSemanticHtml, countWords, extractPlainTextFromHtml } from '../utils/richText';
import { ModelId } from '../types/models';
import { DEFAULT_GLOBAL_MODEL_ID, MODEL_REGISTRY } from './modelRegistry';
import { SavedEditorialIdea } from '../types/ideaGenerator';
import { ResearchStudy, ResearchClaim, ResearchFile } from '../types/research';
import { indexedDBService, STORES } from './indexedDB';
import { syncEngine } from './syncEngine';

const STORAGE_KEY_PROJECTS = 'sog_writing_projects_v2';
const STORAGE_KEY_GLOBAL_RULES = 'sog_global_instructions_v2';
const STORAGE_KEY_ACTIVE_PROJECT_ID = 'sog_active_project_id_v2';
const STORAGE_KEY_THEME = 'sog_active_theme_v3';
const STORAGE_KEY_STYLE_PROFILES = 'sog_style_profiles_v3';
const STORAGE_KEY_INTERNAL_LINKS = 'sog_internal_links_v4';
const STORAGE_KEY_LINK_CATEGORIES = 'sog_link_categories_v4';
const STORAGE_KEY_GLOBAL_MODEL = 'sog_global_ai_model_v1';
const STORAGE_KEY_SAVED_IDEAS = 'sog_saved_editorial_ideas_v1';
const STORAGE_KEY_RESEARCH_STUDIES = 'sog_research_studies_v1';
const STORAGE_KEY_RESEARCH_CLAIMS = 'sog_research_claims_v1';
const STORAGE_KEY_RESEARCH_FILES = 'sog_research_files_v1';
const STORAGE_KEY_LAST_BACKUP = 'sog_last_backup_timestamp_v1';

const storageListeners = new Set<() => void>();
const pendingLocalProjects = new Map<string, WritingProject>();

function mergeWithTombstones<T extends { id: string; updatedAt?: string; deletedAt?: string; _isDeleted?: boolean }>(
  localRaw: T[],
  remoteRaw: T[]
): T[] {
  const localMap = new Map<string, T>();
  localRaw.forEach((item) => localMap.set(item.id, item));

  const mergedMap = new Map<string, T>(localMap);

  remoteRaw.forEach((remote) => {
    const local = localMap.get(remote.id);
    if (!local) {
      mergedMap.set(remote.id, remote);
    } else {
      const localTime = new Date(local.updatedAt || (local as any).deletedAt || 0).getTime();
      const remoteTime = new Date(remote.updatedAt || (remote as any).deletedAt || 0).getTime();

      if (remoteTime > localTime) {
        mergedMap.set(remote.id, remote);
      } else if (remoteTime < localTime) {
        mergedMap.set(remote.id, local);
      } else {
        if (remote._isDeleted || local._isDeleted) {
          mergedMap.set(remote.id, {
            ...local,
            ...remote,
            _isDeleted: true,
          });
        } else {
          mergedMap.set(remote.id, remote);
        }
      }
    }
  });

  return Array.from(mergedMap.values());
}

export const DEFAULT_WRITING_CONTROLS: WritingControls = {
  tone: 'editorial',
  detail: 'balanced',
  marketing: 'minimal',
  historicalContext: 'moderate',
  audience: 'enthusiast',
  wordCountTarget: '1,200 - 1,500 words',
};

export const DEFAULT_AI_SETTINGS: AISettings = DEFAULT_WRITING_CONTROLS;

export const DEFAULT_GLOBAL_INSTRUCTIONS: GlobalInstruction[] = [
  {
    id: 'gi-1',
    text: "Never use generic AI filler phrases: 'Whether you're looking for...', 'Perfect for...', 'A thoughtful and meaningful gift...', 'In today's world...', 'Takes it to the next level...', 'Something they'll cherish...', 'Ideal choice for...', 'Designed to...'",
    category: 'voice',
    enabled: true,
  },
  {
    id: 'gi-2',
    text: "Do not use em dashes (—). Use colons, parentheses, semicolons, or natural sentence breaks instead.",
    category: 'constraint',
    enabled: true,
  },
  {
    id: 'gi-3',
    text: "Avoid hyperbolic marketing language. Write with calm, knowledgeable, civilized editorial authority.",
    category: 'style',
    enabled: true,
  },
  {
    id: 'gi-4',
    text: "Factual integrity is absolute: never invent product specifications, dimensions, origins, or historical claims not supplied in raw notes.",
    category: 'factuality',
    enabled: true,
  },
  {
    id: 'gi-5',
    text: "Favor specific physical observations (the drag of a nib, weight of vegetable-tanned bridle leather) over vague praise ('luxurious', 'stunning').",
    category: 'style',
    enabled: true,
  },
  {
    id: 'gi-6',
    text: "Vary sentence length and rhythm. Do not start sequential paragraphs with 'This [item] is...' or 'It also features...'.",
    category: 'style',
    enabled: true,
  },
  {
    id: 'gi-7',
    text: "Explain *why* an object matters to the recipient: its utility, craft heritage, and how it quietly enhances daily rituals.",
    category: 'voice',
    enabled: true,
  },
  {
    id: 'gi-8',
    text: "Keep SEO keywords conversational. Never stuff keywords or force awkward syntax for search engines.",
    category: 'constraint',
    enabled: true,
  },
];

export const DEFAULT_CONTENT_RULES: ContentRule[] = [
  { id: 'cr-1', rule: 'No em dashes in copy', enabled: true },
  { id: 'cr-2', rule: 'No cliché gift adjectives (e.g. thoughtful, unique, ultimate, perfect)', enabled: true },
  { id: 'cr-3', rule: 'Include tangible tactile or material detail', enabled: true },
  { id: 'cr-4', rule: 'Keep product entries under 170 words', enabled: true },
  { id: 'cr-5', rule: 'Focus on provenance and everyday use', enabled: true },
];

export const DEFAULT_BRIEF: ProjectBrief = {
  purpose: 'Provide discerning readers with an intelligent, well-observed guide free from commercial fluff.',
  audience: 'Thoughtful gifters who appreciate craft, understated design, and objects with history.',
  readerLearns: 'The nuanced difference between mass-produced novelty and heirloom-grade craftsmanship.',
  readerFeels: 'Confident, enlightened, and relieved to find recommendations written by an actual human connoisseur.',
  readerAction: 'Choose a gift with genuine conviction rather than panic-buying a generic listicle item.',
  keyPoints: [
    'Examine materials and construction techniques',
    'Highlight the emotional resonance of longevity',
    'Provide honest notes on sizing or care',
  ],
  thingsToAvoid: [
    'Amazon affiliate listicle cliches',
    'Vague claims like "best on the market"',
    'Overly technical jargon without practical context',
  ],
};

const SEED_PROJECTS: WritingProject[] = [
  {
    id: 'proj-seed-article-1',
    type: 'article',
    title: 'The Quiet Longevity of Mechanical Field Watches',
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-10-06T14:30:00.000Z',
    status: 'in_progress',
    projectInstructions: 'Focus on the tactile ritual of manual winding and why mechanical tools feel grounding in a screen-saturated era. Maintain a warm, literary tone.',
    brief: {
      ...DEFAULT_BRIEF,
      purpose: 'Examine why a utilitarian field watch makes a profoundly personal gift.',
      keyPoints: [
        'The historical transition from trench watches to civilian field timepieces',
        'Tactile engagement: daily winding versus disposable batteries',
        'Legibility, brushed steel, and the aesthetic of honest tools',
      ],
      thingsToAvoid: ['Luxury flex culture', 'Rolex hype language', 'Spec-sheet dump'],
    },
    outline: [
      { id: 'sec-1', title: 'Introduction: The antidote to planned obsolescence', notes: 'Open with the contrast between glowing notifications and a ticking escapement.' },
      { id: 'sec-2', title: 'A Short Lineage of Utility', notes: 'From dirty dozen specifications to the modern wrist.' },
      { id: 'sec-3', title: 'Why Gifting Mechanical Time Matters', notes: 'Giving someone a tool meant to outlive them.' },
      { id: 'sec-4', title: 'What to Look For: Case, Movement, and Strap', notes: 'Prioritize sapphire or domed acrylic, water resistance, and serviceability.' },
      { id: 'sec-5', title: 'Conclusion: The ritual of winding', notes: 'Closing thought on slowing down.' },
    ],
    contentRules: [
      { id: 'r1', rule: 'No em dashes', enabled: true },
      { id: 'r2', rule: 'Avoid luxury snobbery or investment talk', enabled: true },
      { id: 'r3', rule: 'Emphasize tactile sensation and serviceability', enabled: true },
    ],
    writingControls: {
      tone: 'editorial',
      detail: 'balanced',
      marketing: 'minimal',
      historicalContext: 'deep',
      audience: 'enthusiast',
      wordCountTarget: '1,200 - 1,500 words',
    },
    aiSettings: {
      tone: 'editorial',
      detail: 'balanced',
      marketing: 'minimal',
      historicalContext: 'deep',
      audience: 'enthusiast',
      wordCountTarget: '1,200 - 1,500 words',
    },
    articleMeta: {
      slug: 'mechanical-field-watches-guide',
      seoTitle: 'Why a Mechanical Field Watch Is the Ultimate Thoughtful Gift',
      metaDescription: 'An editorial examination of field watches, tool aesthetics, and why mechanical timepieces outlast modern electronics.',
      standfirst: 'In an era defined by vibrating wrists and disposable screens, an unadorned mechanical watch offers something increasingly rare: honest permanence.',
      category: 'Product & Craft Advice',
      author: {
        name: 'Julian Vance',
        role: 'Senior Horology & Tool Heritage Editor',
        bio: 'Specializing in mechanical craft, tool heritage, and tactile longevity.',
      },
      heroImage: {
        url: 'https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=1600&q=80',
        altText: 'Brushed stainless steel mechanical field watch resting on weathered canvas and oiled oak',
        caption: 'A vintage mechanical field watch: designed for legibility and built without planned obsolescence.',
        credit: 'Science of Gifts Editorial Archive',
      },
      targetKeyword: 'mechanical field watch gift',
      secondaryKeywords: ['vintage field watch', 'manual wind watches', 'everyday carry watch'],
      audience: 'Design-conscious adults seeking durable, heirloom-worthy gifts',
      searchIntent: 'In-depth editorial guidance on gifting mechanical tool watches',
      tags: ['Field Watches', 'Mechanical Timepieces', 'Heirloom Craft', 'Daily Rituals', 'Everyday Carry'],
      sources: [
        'British Ministry of Defence Standard 66-4 (Trench & Field Horology)',
        'Horological Society of New York: The Mechanics of Manual Winding',
      ],
      relatedContent: [
        {
          title: 'The Tactile Permanence of Hand-Wound Watches',
          url: 'https://www.scienceofgifts.com/tactile-permanence-hand-wound-watches/',
        },
        {
          title: 'The Art of Giving Objects That Age Gracefully',
          url: 'https://www.scienceofgifts.com/giving-objects-that-age-gracefully/',
        },
      ],
      publishedAt: '2026-10-06T14:30:00.000Z',
    },
    attachedStudyIds: ['study-tactile-psychology'],
    editorialDevelopment: {
      originalIdea: {
        id: 'idea-seed-1',
        title: 'The Quiet Longevity of Mechanical Field Watches',
        angle: 'Why utilitarian mechanical timepieces that require daily winding offer profound emotional permanence over smart devices.',
        whyInteresting: 'Inverts the contemporary fetish for frictionless convenience by proving that conscious manual ritual fosters enduring attachment.',
        searchIntent: 'In-depth editorial guidance on gifting mechanical tool watches',
      },
      angles: [
        {
          id: 'angle-seed-1',
          title: 'The Friction Paradox: Why Manual Winding Fosters Emotional Longevity',
          coreArgument: 'Objects that require deliberate physical participation forge lasting psychological attachment, whereas frictionless gadgets become disposable novelties.',
          whyInteresting: 'Directly challenges modern commercial ease by championing daily tactile ritual.',
          whatArticleEmphasizes: 'The morning winding ritual, mechanical escapements vs disposable batteries, and psychological ownership.',
          possibleTakeaway: 'Choose gifts that ask for stewardship rather than push-button passivity.',
          role: 'primary',
        },
        {
          id: 'angle-seed-2',
          title: 'The Architecture of Quiet Longevity: Bench Repair vs Industrial Obsolescence',
          coreArgument: 'Durability is about modular serviceability, unhurried tolerances, and designs intended for repair by human hands across decades.',
          whyInteresting: 'Moves focus from luxury hype to the tangible realities of repairable bench-made tools.',
          whatArticleEmphasizes: 'Disassembly, stainless steel cases, water resistance, and serviceable mechanical calibers.',
          possibleTakeaway: 'Value objects by whether an independent watchmaker could service them in fifty years.',
          role: 'secondary',
        },
        {
          id: 'angle-seed-3',
          title: 'A Short Lineage of Trench Horology: Honest Utility vs Luxury Flex',
          coreArgument: 'Utilitarian field watches carry historical dignity because every millimeter was engineered for low-light survival rather than social status.',
          whyInteresting: 'Provides a civilized critique of Rolex hype culture without sounding cynical.',
          whatArticleEmphasizes: 'Dirty Dozen military specifications, matte finishes, stark legible typography.',
          possibleTakeaway: 'A modest tool watch communicates quiet discernment rather than loud brand pretense.',
          role: 'brief_mention',
        },
        {
          id: 'angle-seed-4',
          title: 'The Smartwatch Trap: Why Screen Appliances Make Terrible Heirlooms',
          coreArgument: 'Smartwatches are consumable consumer electronics with built-in obsolescence, not enduring gifts.',
          whyInteresting: 'Addresses the common gift-buyer dilemma between digital convenience and mechanical permanence.',
          whatArticleEmphasizes: 'Battery degradation curves, notification fatigue, and planned obsolescence.',
          possibleTakeaway: 'Gifts intended to mark major milestones should possess hardware that never becomes a paperweight.',
          role: 'brief_mention',
        },
        {
          id: 'angle-seed-5',
          title: 'Everyday Stewardship: Giving Tools Meant to Outlive the Giver',
          coreArgument: 'The finest gifts transform the recipient from an owner into a custodian for the next generation.',
          whyInteresting: 'Reframes purchasing as intergenerational lineage.',
          whatArticleEmphasizes: 'Patina, service records, and timeless 38mm proportions.',
          possibleTakeaway: 'Select objects whose beauty will remain coherent forty years from now.',
          role: 'do_not_use',
        },
      ],
      direction: {
        primaryAngleId: 'angle-seed-1',
        secondaryAngleId: 'angle-seed-2',
        briefMentionAngleIds: ['angle-seed-3', 'angle-seed-4'],
        doNotUseAngleIds: ['angle-seed-5'],
        editorsDirection: 'Focus on the tactile ritual of manual winding and why mechanical tools feel grounding in a screen-saturated era. Maintain a warm, literary tone and avoid luxury flex culture.',
      },
      brief: {
        workingTitle: 'The Quiet Longevity of Mechanical Field Watches',
        topic: 'Why utilitarian mechanical timepieces that require daily winding offer profound emotional permanence',
        audience: 'Thoughtful gifters, craft enthusiasts, and readers seeking authentic human discernment over commercial listicles',
        searchIntent: 'In-depth editorial guidance on gifting mechanical tool watches',
        primaryAngle: 'The Friction Paradox: Why Manual Winding Fosters Emotional Longevity',
        secondaryFocus: 'The Architecture of Quiet Longevity: Bench Repair vs Industrial Obsolescence',
        briefMentions: [
          'A Short Lineage of Trench Horology: Honest Utility vs Luxury Flex',
          'The Smartwatch Trap: Why Screen Appliances Make Terrible Heirlooms',
        ],
        thingsToAvoid: [
          'Avoid luxury flex culture and Rolex investment snobbery',
          'Superficial listicle clichés and unexamined hype adjectives',
        ],
        centralArgument: 'Objects that require deliberate physical participation forge lasting psychological attachment, whereas frictionless gadgets become disposable novelties. A mechanical field watch offers honest permanence because its spring stores human energy and its architecture invites repair.',
        keyQuestions: [
          'Why does deliberate mechanical friction create deeper emotional permanence than convenience appliances?',
          'What engineering hallmarks separate repairable bench instruments from planned industrial obsolescence?',
          'How does gifting a hand-wound watch offer an antidote to modern notification fatigue?',
        ],
        editorialDirection: 'Focus on the tactile ritual of manual winding and why mechanical tools feel grounding in a screen-saturated era. Maintain a warm, literary tone and avoid luxury flex culture.',
        suggestedTakeaway: 'When selecting an enduring gift, value modular repairability, honest provenance, and everyday utility over fleeting prestige.',
        factualContext: [
          'Empirical research on material permanence confirms tactile artifacts strengthen emotional attachment over time.',
          'British Ministry of Defence Standard 66-4 specifications established 36-38mm matte cases and high-contrast dials for field utility.',
        ],
        editorialInterpretation: [
          'The daily sixty-second winding ritual serves as a quiet psychological anchor against digital notification overload.',
          'Choosing an unadorned field watch expresses respect for the recipient’s discernment rather than social vanity.',
        ],
        internalLinkOpportunities: [
          'The Tactile Permanence of Hand-Wound Watches (https://www.scienceofgifts.com/tactile-permanence-hand-wound-watches/)',
          'The Art of Giving Objects That Age Gracefully (https://www.scienceofgifts.com/giving-objects-that-age-gracefully/)',
        ],
        styleConsiderations: 'Literary, contemplative, precise. Warm and observant, devoid of commercial hyperbole.',
        generatedAt: '2026-10-06T14:30:00.000Z',
        updatedAt: '2026-10-06T14:30:00.000Z',
      },
      status: 'brief_ready',
      lastGeneratedAt: '2026-10-06T14:30:00.000Z',
    },
    content: `<h1>The Quiet Longevity of Mechanical Field Watches</h1><p>In an era defined by vibrating wrists and disposable screens, an unadorned mechanical watch offers something increasingly rare: honest permanence. When you give someone a smartwatch, you are essentially gifting an appliance with a two-year countdown until its lithium-ion cell swells and its operating system ceases receiving security updates.</p><p>A mechanical field watch operates on an entirely different philosophical plane. Its spring stores human energy. Its escapement measures time through the physical friction of synthetic rubies and hairspring oscillations. Treated with even modest respect and serviced once every decade, it will easily outlast the person who unboxed it.</p><h2>The Lineage of Honest Utility</h2><p>The archetype of the modern field watch was forged under brutal military specifications: matte stainless steel to prevent light reflection, stark white numerals on an inky dial for low-light legibility, and drilled lugs sturdy enough to survive damp canvas webbing.</p><img src="https://images.unsplash.com/photo-1524805444758-089113d48a6d?auto=format&fit=crop&w=1200&q=80" alt="Brushed stainless steel mechanical field watch movement and dial" /><p>There was no room for decorative guilloché or gold plating. Every curve of the 38-millimeter case served a single mandate, which was to remain legible in mud, rain, and dim dawn light.</p><blockquote><p>A utilitarian field watch does not pretend to be jewellery. It slides comfortably beneath the cuff of an Oxford shirt without drawing attention to itself, yet it possesses the quiet substance of a well-oiled pocket knife.</p></blockquote><h2>The Tactile Ritual of Daily Winding</h2><p>There is a distinct, grounding pleasure in exploring the <a href="https://www.scienceofgifts.com/tactile-permanence-hand-wound-watches/">tactile permanence of mechanical watches</a> over morning coffee. You feel the micro-clicks through the crown; you hear the tiny click-spring engaging each tooth on the ratchet wheel. It is an intentional sixty seconds in a morning usually consumed by unread notifications.</p><p>When selecting a field watch as a gift, consider the balance between heritage and daily comfort:</p><ul><li><strong>Case Dimensions:</strong> Look for 36mm to 38mm proportions that suit diverse wrists.</li><li><strong>Water Resistance:</strong> 50 to 100 meters ensures protection against downpours.</li><li><strong>Lug Width:</strong> Standard 20mm drilled lugs invite easy strap swapping.</li></ul><p>Ultimately, a mechanical field watch is an investment in human cadence, reminding the wearer that time is meant to be lived rather than measured in notifications.</p>`
  },
  {
    id: 'proj-seed-guide-1',
    type: 'gift_guide',
    title: '8 Gifts for the Cartography & Map Obsessive',
    createdAt: '2026-09-30T11:15:00.000Z',
    updatedAt: '2026-10-06T12:00:00.000Z',
    status: 'in_progress',
    projectInstructions: 'Focus on paper quality, historical coordinates, relief shading, and analog exploration. Keep entries observant and witty.',
    brief: {
      ...DEFAULT_BRIEF,
      purpose: 'A curated selection of tactile, handsome gifts for people who collect maps, study contours, and love geography.',
      keyPoints: ['Highlight paper weights and letterpress techniques', 'Celebrate real spatial orientation over GPS screens'],
      thingsToAvoid: ['Generic scratch-off world travel maps', 'Cheap plastic globes', 'Gimmicky compass keychains'],
    },
    outline: [
      { id: 'g1', title: 'Introduction: The romance of contours and coordinates' },
      { id: 'g2', title: 'Product 1: Dalvey Voyager Brass Pocket Compass' },
      { id: 'g3', title: 'Product 2: Topographic Letterpress Elevation Prints' },
      { id: 'g4', title: 'Product 3: The Times Comprehensive Atlas of the World' },
      { id: 'g5', title: 'Buyer Advice: Avoiding tourist kitsch' },
      { id: 'g6', title: 'FAQ: Framing and storing vintage maps' },
    ],
    contentRules: [
      { id: 'cr-gg1', rule: 'No scratch-off maps or airport novelties', enabled: true },
      { id: 'cr-gg2', rule: 'Mention exact printing or manufacturing details', enabled: true },
      { id: 'cr-gg3', rule: 'Under 160 words per product entry', enabled: true },
    ],
    writingControls: {
      tone: 'witty',
      detail: 'balanced',
      marketing: 'minimal',
      historicalContext: 'moderate',
      audience: 'enthusiast',
      wordCountTarget: '1,000 - 1,200 words',
    },
    aiSettings: {
      tone: 'witty',
      detail: 'balanced',
      marketing: 'minimal',
      historicalContext: 'moderate',
      audience: 'enthusiast',
      wordCountTarget: '1,000 - 1,200 words',
    },
    giftGuideMeta: {
      slug: 'gifts-for-map-lovers-cartography',
      seoTitle: '8 Thoughtful Gifts for Cartography Lovers & Geography Geeks',
      metaDescription: 'A discerning editorial gift guide for map enthusiasts, featuring letterpress elevation prints, brass pocket compasses, and archival atlases.',
      standfirst: 'For people who find poetry in contour intervals, hachures, and the tactile weight of archival rag paper.',
      targetKeyword: 'gifts for map lovers',
      primaryTopic: 'Cartography, maps, topography, and spatial exploration tools',
      searchIntent: 'High-intent gift recommendations for cartophiles and hikers',
      audience: 'Cartophiles, hikers, urban historians, and print collectors',
      occasionOrNiche: 'Cartography & Geography Enthusiasts',
      collectionUrl: 'https://shop.scienceofgifts.com/collections/cartography-gifts',
      desiredWordCount: '1,400 - 1,800 words',
      additionalInstructions: 'Emphasize printing provenance, paper rag weight, and physical instruments over smartphone apps.',
      settings: {
        sectionFormat: 'standard',
        showBestFor: true,
        showBuyerAdvice: true,
        showFaq: true,
        showConclusion: true,
        numberProducts: true,
        includeCollectionLink: true,
        desiredSectionLength: '130 - 160 words',
      },
      buyerAdvice: 'When shopping for someone who loves maps, steer clear of mass-produced travel bucket list posters. Look for archival cotton paper, authentic datum lines, or instruments machined from solid brass.',
      faqList: [
        {
          id: 'faq-1',
          question: 'How should archival maps and relief prints be framed?',
          answer: 'Mount with acid-free rag mats behind museum-grade UV-filtering glass. Direct sunlight will fade pigments over years.',
        },
        {
          id: 'faq-2',
          question: 'Is a vintage brass pocket compass still functional for navigation?',
          answer: 'Yes, though magnetic declination shifts subtly over time. For orientation or sentimental utility, it remains completely reliable.',
        },
      ],
      faq: `Q: How should a recipient store archival paper maps?\nA: Keep them flat in acid-free portfolios away from direct ultraviolet light, or frame them behind museum-grade UV-filtering glass.\n\nQ: Is a vintage compass still functional today?\nA: Yes, though magnetic declination drifts slightly over centuries. For decorative or sentimental use, an analog compass remains timeless.`,
      conclusion: 'Maps are not merely navigational records; they are snapshots of how humans have attempted to tame, comprehend, and admire the landscape. A gift anchored in cartography honors both curiosity and patience.',
      products: [
        {
          id: 'prod-1',
          name: 'Dalvey Voyager Brass Pocket Compass',
          url: 'https://shop.scienceofgifts.com/products/dalvey-voyager-compass',
          summary: 'Machined Scottish brass pocket instrument with liquid-damped jewel capsule.',
          productType: 'Navigational Instrument / Pocket Compass',
          historicalContext: 'Inspired by early 20th-century maritime observation instruments.',
          materialDetails: 'Solid mirror-polished brass, stainless steel push-button latch, synthetic sapphire bearing.',
          designDetails: 'Liquid-filled capsule with precision compass rose and spring-loaded lid.',
          whyItFits: 'Offers real tactile heft and authentic mechanical orientation without battery reliance.',
          bestFor: 'The hiker, sailor, or desk connoisseur who appreciates precision brass instruments.',
          buyerConsiderations: 'Heavier than modern hiking compasses; meant for heirloom pocket or desk carry.',
          notes: 'Tactile push-button release snaps open with an authoritative click.',
          productInstructions: 'Highlight the jewel movement and why a manual compass grounds the owner.',
          rawInfo: 'Precision-engineered stainless steel and mirror-polished brass casing. Liquid-filled capsule with sapphire jewel bearing. Diameter 70mm, thickness 18mm. Made in the Scottish Highlands.',
          generatedCopy: 'Machined in the Scottish Highlands, this substantial pocket compass bridges the gap between scientific instrument and personal heirloom. The push-button lid snaps open with the authoritative click of an Edwardian pocket watch, revealing a liquid-damped dial balanced on a synthetic sapphire jewel. It carries enough heft in the palm to feel anchored in an older century, yet the needle settles on magnetic north with instantaneous precision.'
        },
        {
          id: 'prod-2',
          name: 'Letterpress Topographic Ridge Elevation Print',
          url: 'https://shop.scienceofgifts.com/products/topographic-letterpress-print',
          summary: 'Deep-debossed relief contour print on 600gsm heavy cotton rag.',
          productType: 'Wall Art / Relief Print',
          historicalContext: 'Contour elevation mapping standardized by the US Geological Survey.',
          materialDetails: '600gsm Somerset 100% cotton paper, mineral oil-based ink.',
          designDetails: 'Hand-pulled relief print creating physical terraced steps on cylinder press.',
          whyItFits: 'Turns two-dimensional geography into a three-dimensional tactile sculpture.',
          bestFor: 'Designers, mountaineers, and anyone who studies ridge lines and mountain passes.',
          buyerConsiderations: 'Unframed; fits standard 18x24 inch gallery frames.',
          notes: 'The contour steps create natural shifting shadows in changing room light.',
          productInstructions: 'Focus on the physical impression into thick cotton paper.',
          rawInfo: 'Printed on 600gsm Somerset 100% cotton rag paper. Deep debossed contour lines based on USGS 1:24,000 elevation data. Hand-pulled on a 1958 Heidelberg cylinder press.',
          generatedCopy: 'Unlike standard digital inkjet posters, this piece treats topography as physical sculpture. Pressed into pillowy 600-gram cotton paper on a vintage Heidelberg cylinder press, the contour lines create palpable terraces you can trace with your thumb. The shadows change as the sun moves across the room, mimicking the actual ridge lines of the mountain range it documents.'
        },
        {
          id: 'prod-3',
          name: 'Solid Brass 3-Inch Desk Magnifier & Paperweight',
          url: 'https://shop.scienceofgifts.com/products/brass-desk-magnifier',
          summary: 'Crown-glass optical lens set in heavy unlacquered turned brass ring.',
          productType: 'Desk Tool / Optical Magnifier',
          historicalContext: 'Echoes 19th-century cartographic inspection loupes.',
          materialDetails: 'Solid turned brass with raw brushed rim, 4x optical crown glass lens.',
          designDetails: 'Beveled rim allows it to glide smoothly across delicate antique paper without scratching.',
          whyItFits: 'Indispensable for scrutinizing fine hachures and minute map typography.',
          bestFor: 'The antiquarian book reader and map collector studying delicate details.',
          buyerConsiderations: 'Unlacquered brass will naturally develop warm patina with finger oils.',
          notes: 'Double duty as a weighty paperweight for curling rolled charts.',
          productInstructions: 'Emphasize optical clarity and how it invites close, unhurried study.',
          rawInfo: '4x magnification optical glass. Weight: 420g. Turned raw brass housing.',
          generatedCopy: 'A good map invites inspection at arm’s length, but an exceptional one demands scrutiny at three inches. This solid brass desk magnifier features ground crown glass that clarifies minute typography without edge distortion. Machined with a smooth beveled rim, it glides across delicate rag paper without catching, doubling as a reassuringly heavy paperweight for unruly rolled charts.'
        }
      ]
    },
    content: `<h1>8 Gifts for the Cartography & Map Obsessive</h1><p>For people who find poetry in contour intervals, hachures, and the tactile weight of archival rag paper, a map is never just a way to find a motorway exit. It is a portrait of human curiosity.</p><p>Cartophiles belong to a particular tribe. They are the friends who stop mid-trail to decipher a benchmark symbol, who browse antiquarian bookshops solely for unfolded plates, and who harbor a quiet disdain for the sterile blue dot of smartphone navigation.</p><p>When choosing a gift for someone with this inclination, resist the temptation of generic scratch-off posters. What follows are items built with genuine graphic integrity and physical substance.</p><h2>Dalvey Voyager Brass Pocket Compass</h2><p>Machined in the Scottish Highlands, this substantial pocket compass bridges the gap between scientific instrument and personal heirloom. The push-button lid snaps open with the authoritative click of an Edwardian pocket watch, revealing a liquid-damped dial balanced on a synthetic sapphire jewel. It carries enough heft in the palm to feel anchored in an older century, yet the needle settles on magnetic north with instantaneous precision.</p><h2>Letterpress Topographic Ridge Elevation Print</h2><p>Unlike standard digital inkjet posters, this piece treats topography as physical sculpture. Pressed into pillowy 600-gram cotton paper on a vintage Heidelberg cylinder press, the contour lines create palpable terraces you can trace with your thumb. The shadows change as the sun moves across the room, mimicking the actual ridge lines of the mountain range it documents.</p>`
  },
  {
    id: 'proj-seed-prod-1',
    type: 'product_copy',
    title: 'The Marrow of Tradition: 18oz Waxed Canvas Field Bag',
    createdAt: '2026-10-02T09:30:00.000Z',
    updatedAt: '2026-10-06T15:10:00.000Z',
    status: 'review',
    projectInstructions: 'Emphasize the aging process of waxed canvas and bridle leather. Do not use generic marketing hyperbole. Keep the copy crisp, masculine, and literary.',
    brief: {
      ...DEFAULT_BRIEF,
      purpose: 'Write an editorial product page for a high-end bench-made field bag.',
      keyPoints: ['Explain why heavy paraffin wax matters', 'Highlight solid copper rivets hammered by hand'],
      thingsToAvoid: ['Disrupting luggage market', 'Affordable luxury', 'Traveler must-have'],
    },
    outline: [
      { id: 'p1', title: 'Headline & Standfirst' },
      { id: 'p2', title: 'Main Editorial Description' },
      { id: 'p3', title: 'Materials & Provenance' },
      { id: 'p4', title: 'Best For Summary' },
    ],
    contentRules: [
      { id: 'cr-p1', rule: 'Stick strictly to provided specs (18oz canvas, English bridle leather)', enabled: true },
      { id: 'cr-p2', rule: 'No promotional countdowns or sales jargon', enabled: true },
      { id: 'cr-p3', rule: 'Under 220 words for the main description', enabled: true },
    ],
    writingControls: {
      tone: 'sophisticated',
      detail: 'balanced',
      marketing: 'minimal',
      historicalContext: 'moderate',
      audience: 'expert',
      wordCountTarget: '400 - 600 words',
    },
    aiSettings: {
      tone: 'sophisticated',
      detail: 'balanced',
      marketing: 'minimal',
      historicalContext: 'moderate',
      audience: 'expert',
      wordCountTarget: '400 - 600 words',
    },
    productCopyMeta: {
      productName: 'The Marrow of Tradition 18oz Waxed Canvas Field Bag',
      productType: 'Carryall / Shoulder Bag',
      productUrl: 'https://example.com/waxed-field-bag',
      rawProductInfo: '18oz Scottish paraffin-waxed duck canvas. 9oz vegetable-tanned English bridle leather straps from J&E Sedgwick. Hand-peened solid copper saddlers rivets. Heavy #10 brass double zip with storm flap. Solid brass hardware cast in Walsall, England. Interior slip pocket fits a 15-inch laptop. Dimensions: 42cm x 31cm x 13cm.',
      materials: '18oz paraffin-waxed cotton, Sedgwick English bridle leather, cast brass, hand-hammered copper rivets.',
      features: 'Storm flap zipper cover, reinforced double-layer base, removable shoulder strap, two exterior stash pockets.',
      designDetails: 'Unlined interior showcasing raw canvas selvedge, burnished leather edges hand-finished with beeswax.',
      historicalContext: 'Pattern inspired by British gamekeeper bags of the 1930s, adapted for modern portable work.',
      targetAudience: 'Architects, writers, field researchers, and individuals who prefer gear that looks better after five years of hard rain.',
      headline: 'A Field Bag That Improves With Every Rainstorm',
      standfirst: 'Crafted from dense 18-ounce paraffin canvas and hand-peened copper rivets, built to outlast trends and weather decades.',
      description: 'Most modern bags arrive at their peak on the day you cut their tags off; from that moment forward, ballistic nylon pills and synthetic coatings steadily degrade. This field bag is built on the inverse principle. The 18-ounce Scottish duck canvas arrives stiff and unapologetic, but within weeks of carrying books, tools, and damp commutes, the paraffin wax creases into a marble-like patina unique to your stride.\n\nEvery stress point is bound by heavy 9-ounce bridle leather and hand-peened copper saddler rivets, the same unyielding fasteners used on cavalry harnesses. The brass teeth of the number ten zipper are sheltered under a generous storm flap, keeping notebooks dry when cloudbursts catch you without an umbrella. It is heavy, handsome, and entirely indifferent to fleeting trends.',
      bestFor: 'Field research, daily commutes, carrying notebooks and cameras through wet autumn afternoons.',
      slug: 'waxed-canvas-field-bag',
      seoTitle: 'Bench-Made Waxed Canvas Field Bag | Science of Gifts',
      metaDescription: 'Handcrafted from 18oz Scottish waxed canvas and English bridle leather. An heirloom shoulder bag built for decades of daily utility.',
    },
    content: `<h1>The Marrow of Tradition: 18oz Waxed Canvas Field Bag</h1><p><strong>Crafted from dense 18-ounce paraffin canvas and hand-peened copper rivets, built to outlast trends and weather decades.</strong></p><p>Most modern bags arrive at their peak on the day you cut their tags off; from that moment forward, ballistic nylon pills and synthetic coatings steadily degrade. This field bag is built on the inverse principle. The 18-ounce Scottish duck canvas arrives stiff and unapologetic, but within weeks of carrying books, tools, and damp commutes, the paraffin wax creases into a marble-like patina unique to your stride.</p><p>Every stress point is bound by heavy 9-ounce bridle leather and hand-peened copper saddler rivets, the same unyielding fasteners used on cavalry harnesses. The brass teeth of the number ten zipper are sheltered under a generous storm flap, keeping notebooks dry when cloudbursts catch you without an umbrella. It is heavy, handsome, and entirely indifferent to fleeting trends.</p><h3>Specifications & Provenance</h3><ul><li><strong>Body:</strong> 18oz Scottish paraffin-waxed duck canvas</li><li><strong>Leather:</strong> 9oz Sedgwick vegetable-tanned English bridle leather</li><li><strong>Fasteners:</strong> Hand-peened solid copper saddlers rivets</li><li><strong>Hardware:</strong> Sand-cast solid brass buckle and snaps</li><li><strong>Capacity:</strong> Accommodates a 15-inch laptop, hardbound notebooks, and knitwear</li></ul>`
  },
  {
    id: 'proj-seed-article-teacher',
    type: 'article',
    title: 'The Art of Thoughtful Teacher Appreciation',
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T16:00:00.000Z',
    status: 'in_progress',
    projectInstructions: 'Explore meaningful educator appreciation without relying on clichés. Maintain an observant, civilized tone.',
    brief: {
      ...DEFAULT_BRIEF,
      purpose: 'Examine how to choose gifts for educators that respect their discipline and personal identity.',
      keyPoints: [
        'Moving beyond disposable gift cards and generic scented candles',
        'Connecting gifts to what teachers enjoy outside the classroom',
        'Useful desk objects that reflect personal or subject identity',
      ],
      thingsToAvoid: ['Plastic gimmicks', 'Apples for the teacher tropes', 'Generic retail filler'],
    },
    outline: [
      { id: 't1', title: 'The Staff Room Cliché Dilemma' },
      { id: 't2', title: 'Honoring the Academic Discipline' },
      { id: 't3', title: 'Objects of Everyday Desk Utility' },
      { id: 't4', title: 'Conclusion: Appreciation with Permanence' },
    ],
    contentRules: [...DEFAULT_CONTENT_RULES],
    writingControls: { ...DEFAULT_WRITING_CONTROLS },
    aiSettings: { ...DEFAULT_WRITING_CONTROLS },
    content: `<h1>The Art of Thoughtful Teacher Appreciation</h1><p>Every June and December, school staff rooms become flooded with generic scented candles, supermarket chocolates, and disposable mugs that eventually end up at thrift shops. While the sentiment is well-intentioned, genuine gratitude for educators requires a little more discernment.</p><p>When picking a gift for a history teacher, think about what they enjoy outside the classroom, too. A thoughtful mentor spends evenings grading essays, reading monographs, and translating difficult primary sources for young minds.</p><p>Mugs don't make great gifts unless they reflect something the recipient identifies with, such as this history teacher definition mug. High-fire stoneware that sits beside stacks of paperbacks becomes a faithful companion through long grading sessions.</p><p>Rather than panic purchases, focus on enduring utility and respect for their academic passion.</p>`
  },
  {
    id: 'proj-seed-article-viking',
    type: 'article',
    title: 'Norse Symbolism and the Modern Revival of Viking Heritage',
    createdAt: '2026-10-07T09:00:00.000Z',
    updatedAt: '2026-10-07T14:30:00.000Z',
    status: 'in_progress',
    projectInstructions: 'Examine Norse material culture, authentic knotwork, and why heritage symbols resonate in modern garments.',
    brief: {
      ...DEFAULT_BRIEF,
      purpose: 'Explore the aesthetic and cultural appeal of authentic Norse symbols in modern craft.',
      keyPoints: [
        'Urnes and Borre styles in historical knotwork',
        'Runic compasses and symbolic navigation',
        'Substantial natural fabrics versus synthetic graphic wear',
      ],
      thingsToAvoid: ['Hollywood barbarian clichés', 'Viking horn helmets', 'Cheap polyester prints'],
    },
    outline: [
      { id: 'v1', title: 'Beyond Hollywood Barbarians' },
      { id: 'v2', title: 'The Geometry of Runic Motifs' },
      { id: 'v3', title: 'Heritage Apparel with Substance' },
      { id: 'v4', title: 'Conclusion: Living with Mythic Symbols' },
    ],
    contentRules: [...DEFAULT_CONTENT_RULES],
    writingControls: { ...DEFAULT_WRITING_CONTROLS },
    aiSettings: { ...DEFAULT_WRITING_CONTROLS },
    content: `<h1>Norse Symbolism and the Modern Revival of Viking Heritage</h1><p>The contemporary fascination with Nordic history is rarely about marauding longships; it is about an appreciation for elemental craftsmanship, mythic storytelling, and symbols that endure across centuries.</p><p>From the intricate interwoven knotwork of the Urnes style to runic compasses found in post-medieval manuscripts, Norse motifs represent protection, navigation through adversity, and respect for natural forces.</p><p>For everyday wear that carries symbolic weight, many enthusiasts gravitate toward garments like a viking norse mythology hoodie featuring authentic knotwork. When rendered on heavy unbleached cotton rather than cheap synthetic blends, historic graphics feel grounded and substantial.</p><p>Whether examining hand-forged axes or wearing historic heraldry, honoring heritage requires attention to graphic authenticity and material longevity.</p>`
  }
];

export const storage = {
  getRawProjectsIncludingDeleted(): WritingProject[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PROJECTS);
      if (stored) {
        const parsed: WritingProject[] = JSON.parse(stored);
        const mapped: WritingProject[] = parsed.map((p): WritingProject => {
          const controls = p.writingControls || p.aiSettings || { ...DEFAULT_WRITING_CONTROLS };
          const normalizedControls: WritingControls = {
            ...DEFAULT_WRITING_CONTROLS,
            ...controls,
          };
          let giftGuideMeta = p.giftGuideMeta;
          if (p.type === 'gift_guide') {
            giftGuideMeta = {
              ...DEFAULT_GIFT_GUIDE_METADATA,
              ...(p.giftGuideMeta || {}),
              settings: {
                ...DEFAULT_GUIDE_SETTINGS,
                ...(p.giftGuideMeta?.settings || {}),
              },
              products: p.giftGuideMeta?.products || [],
              faqList: p.giftGuideMeta?.faqList || [],
            };
          }

          let articleMeta = p.articleMeta;
          if (p.type === 'article') {
            const seed = SEED_PROJECTS.find((s) => s.id === p.id);
            const defaultSlug = (p.title || 'untitled-article')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '');
            articleMeta = {
              slug: defaultSlug,
              seoTitle: p.title ? `${p.title} | Science of Gifts` : '',
              metaDescription: '',
              standfirst: '',
              category: 'Product & Craft Advice',
              author: {
                name: 'Science of Gifts Editorial',
                role: 'Staff Writer',
              },
              targetKeyword: '',
              secondaryKeywords: [],
              audience: p.brief?.audience || 'Thoughtful gifters & readers',
              searchIntent: 'Editorial insight & advice',
              tags: [],
              sources: [],
              relatedContent: [],
              ...(seed?.articleMeta || {}),
              ...(p.articleMeta || {}),
            };
          }

          return {
            ...p,
            content: ensureSemanticHtml(p.content),
            writingControls: normalizedControls,
            aiSettings: normalizedControls,
            brief: {
              ...DEFAULT_BRIEF,
              ...(p.brief || {}),
            },
            outline: p.outline || [],
            contentRules: p.contentRules || [...DEFAULT_CONTENT_RULES],
            projectInstructions: p.projectInstructions || '',
            giftGuideMeta,
            articleMeta,
          };
        });

        // Ensure new seed projects (e.g. teacher appreciation and viking articles) are available
        const existingIds = new Set(mapped.map((p) => p.id));
        let added = false;
        for (const seed of SEED_PROJECTS) {
          if (!existingIds.has(seed.id)) {
            mapped.push({
              ...seed,
              writingControls: { ...DEFAULT_WRITING_CONTROLS, ...seed.aiSettings },
              aiSettings: { ...DEFAULT_WRITING_CONTROLS, ...seed.aiSettings },
            } as WritingProject);
            added = true;
          }
        }
        if (added) {
          this.saveRawProjects(mapped);
        }

        if (pendingLocalProjects.size > 0) {
          for (let i = 0; i < mapped.length; i++) {
            const pending = pendingLocalProjects.get(mapped[i].id);
            if (pending) {
              const pendingTime = new Date(pending.updatedAt || 0).getTime();
              const storedTime = new Date(mapped[i].updatedAt || 0).getTime();
              if (pendingTime >= storedTime) {
                mapped[i] = {
                  ...mapped[i],
                  ...pending,
                  content: ensureSemanticHtml(pending.content),
                };
              }
            }
          }
        }

        return mapped;
      }
    } catch (e) {
      console.warn('Failed to read projects from localStorage:', e);
    }
    const seeded: WritingProject[] = SEED_PROJECTS.map((p) => ({
      ...p,
      writingControls: { ...DEFAULT_WRITING_CONTROLS, ...p.aiSettings },
      aiSettings: { ...DEFAULT_WRITING_CONTROLS, ...p.aiSettings },
    }) as WritingProject);
    this.saveRawProjects(seeded);
    return seeded;
  },

  stagePendingProject(project: WritingProject): void {
    pendingLocalProjects.set(project.id, project);
  },

  flushPendingProjects(): void {
    if (pendingLocalProjects.size === 0) return;
    const pendingList = Array.from(pendingLocalProjects.values());
    for (const proj of pendingList) {
      this.saveProject(proj);
    }
  },

  getProjects(): WritingProject[] {
    return this.getRawProjectsIncludingDeleted().filter((p) => !p._isDeleted);
  },

  saveRawProjects(projects: WritingProject[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    } catch (e) {
      console.error('Failed to save projects to localStorage:', e);
    }
    indexedDBService.putMany(STORES.PROJECTS, projects).catch((err) => {
      console.warn('Async IndexedDB saveRawProjects error:', err);
    });
    this.notifyListeners();
  },

  saveProjects(projects: WritingProject[]): void {
    const localRaw = this.getRawProjectsIncludingDeleted();
    const tombstones = localRaw.filter((p) => p._isDeleted);
    const tombstoneMap = new Map(tombstones.map((t) => [t.id, t]));

    const mergedMap = new Map<string, WritingProject>();
    projects.forEach((p) => mergedMap.set(p.id, { ...p, _isDeleted: false }));
    tombstoneMap.forEach((tomb, id) => {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, tomb);
      }
    });
    this.saveRawProjects(Array.from(mergedMap.values()));
  },

  saveProjectsFromRemote(projects: WritingProject[]): void {
    const localRaw = this.getRawProjectsIncludingDeleted();
    const merged = mergeWithTombstones(localRaw, projects);
    for (const remote of projects) {
      const pending = pendingLocalProjects.get(remote.id);
      if (pending) {
        const pendingTime = new Date(pending.updatedAt || 0).getTime();
        const remoteTime = new Date(remote.updatedAt || (remote as any).deletedAt || 0).getTime();
        if (remoteTime > pendingTime) {
          pendingLocalProjects.delete(remote.id);
        }
      }
    }
    this.saveRawProjects(merged);
  },

  getProjectById(id: string): WritingProject | undefined {
    const list = this.getProjects();
    return list.find((p) => p.id === id);
  },

  saveProject(project: WritingProject): void {
    const pending = pendingLocalProjects.get(project.id);
    let targetProject = project;
    if (pending) {
      const pendingTime = new Date(pending.updatedAt || 0).getTime();
      const projectTime = new Date(project.updatedAt || 0).getTime();
      if (pendingTime > projectTime) {
        targetProject = pending;
      } else {
        pendingLocalProjects.delete(project.id);
      }
    }
    const list = this.getRawProjectsIncludingDeleted();
    const index = list.findIndex((p) => p.id === targetProject.id);
    const controls =
      targetProject.writingControls || targetProject.aiSettings || { ...DEFAULT_WRITING_CONTROLS };
    const updated: WritingProject = {
      ...targetProject,
      _isDeleted: false,
      content: ensureSemanticHtml(targetProject.content),
      writingControls: controls,
      aiSettings: controls,
      updatedAt: targetProject.updatedAt || new Date().toISOString(),
    };
    if (index >= 0) {
      list[index] = updated;
    } else {
      list.unshift(updated);
    }
    this.saveRawProjects(list);
  },

  renameProject(id: string, newTitle: string): WritingProject | undefined {
    const list = this.getRawProjectsIncludingDeleted();
    const index = list.findIndex((p) => p.id === id);
    if (index >= 0) {
      const now = new Date().toISOString();
      list[index] = {
        ...list[index],
        title: newTitle.trim(),
        updatedAt: now,
      };
      if (pendingLocalProjects.has(id)) {
        pendingLocalProjects.set(id, list[index]);
      }
      this.saveRawProjects(list);
      return list[index];
    }
    return undefined;
  },

  updateProjectStatus(id: string, status: ProjectStatus): WritingProject | undefined {
    const list = this.getRawProjectsIncludingDeleted();
    const index = list.findIndex((p) => p.id === id);
    if (index >= 0) {
      const now = new Date().toISOString();
      list[index] = {
        ...list[index],
        status,
        updatedAt: now,
      };
      if (pendingLocalProjects.has(id)) {
        pendingLocalProjects.set(id, list[index]);
      }
      this.saveRawProjects(list);
      return list[index];
    }
    return undefined;
  },

  deleteProject(id: string): void {
    pendingLocalProjects.delete(id);
    const localRaw = this.getRawProjectsIncludingDeleted();
    const now = new Date().toISOString();
    const existingIndex = localRaw.findIndex((p) => p.id === id);
    let updated: WritingProject[];

    if (existingIndex >= 0) {
      updated = [...localRaw];
      updated[existingIndex] = {
        ...updated[existingIndex],
        _isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      };
    } else {
      updated = [
        ...localRaw,
        {
          id,
          type: 'article',
          title: 'Deleted Project',
          createdAt: now,
          updatedAt: now,
          status: 'draft',
          content: '',
          projectInstructions: '',
          brief: { ...DEFAULT_BRIEF },
          outline: [],
          contentRules: [],
          writingControls: { ...DEFAULT_WRITING_CONTROLS },
          aiSettings: { ...DEFAULT_WRITING_CONTROLS },
          _isDeleted: true,
          deletedAt: now,
        },
      ];
    }

    this.saveRawProjects(updated);
    try {
      if (typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.deleteRecord === 'function') {
        syncEngine.deleteRecord('projects', id);
      }
    } catch (e) {
      console.warn('SyncEngine deleteRecord notice:', e);
    }
  },

  createProject(type: ProjectType, title?: string, initialData?: Partial<WritingProject>): WritingProject {
    const now = new Date().toISOString();
    const id = `proj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    let defaultTitle = 'Untitled Article';
    if (type === 'gift_guide') defaultTitle = 'Untitled Gift Guide';
    if (type === 'product_copy') defaultTitle = 'Untitled Product Copy';

    const controls = initialData?.writingControls || { ...DEFAULT_WRITING_CONTROLS };

    const newProject: WritingProject = {
      id,
      type,
      title: title || initialData?.title || defaultTitle,
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      content: initialData?.content || '',
      projectInstructions: initialData?.projectInstructions || '',
      brief: {
        ...DEFAULT_BRIEF,
        ...(initialData?.brief || {}),
      },
      outline: initialData?.outline || [
        { id: 'sec-intro', title: 'Introduction', description: 'Opening perspective and thesis' },
        { id: 'sec-core', title: 'Core Perspective & Details', description: 'Tactile craft, provenance, and utility' },
        { id: 'sec-outro', title: 'Conclusion & Recommendations', description: 'Closing thought and buyer guidance' },
      ],
      contentRules: initialData?.contentRules || [...DEFAULT_CONTENT_RULES],
      writingControls: controls,
      aiSettings: controls,
      styleProfileId: initialData?.styleProfileId,
      modelOverride: initialData?.modelOverride,
      attachedStudyIds: initialData?.attachedStudyIds || [],
      selectedClaimIds: initialData?.selectedClaimIds || [],
      editorialDevelopment: initialData?.editorialDevelopment,
    };

    if (type === 'article') {
      newProject.articleMeta = {
        slug: '',
        seoTitle: '',
        metaDescription: '',
        standfirst: '',
        targetKeyword: '',
        secondaryKeywords: [],
        audience: initialData?.brief?.audience || 'Discerning gifters & readers',
        searchIntent: initialData?.articleMeta?.searchIntent || 'Editorial insight & advice',
        ...(initialData?.articleMeta || {}),
      };
      if (!newProject.content) {
        newProject.content = `<h1>${newProject.title}</h1><p>Start writing your article here in unhurried, observant prose...</p>`;
      }
    } else if (type === 'gift_guide') {
      const defaultSlug = (newProject.title || 'untitled-gift-guide')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      newProject.giftGuideMeta = {
        ...DEFAULT_GIFT_GUIDE_METADATA,
        seoTitle: `${newProject.title} | Science of Gifts`,
        slug: defaultSlug,
        settings: { ...DEFAULT_GUIDE_SETTINGS },
        products: [],
        faqList: [],
        ...(initialData?.giftGuideMeta || {}),
      };
      if (!newProject.content) {
        newProject.content = `<h1>${newProject.title}</h1><p>Introduce the curatorial premise of this gift guide here in unhurried, civilized prose...</p>`;
      }
    } else if (type === 'product_copy') {
      newProject.productCopyMeta = {
        productName: newProject.title,
        productType: '',
        productUrl: '',
        rawProductInfo: '',
        materials: '',
        features: '',
        designDetails: '',
        historicalContext: '',
        targetAudience: '',
        headline: '',
        standfirst: '',
        description: '',
        bestFor: '',
        slug: '',
        seoTitle: '',
        metaDescription: '',
        ...(initialData?.productCopyMeta || {}),
      };
      if (!newProject.content) {
        newProject.content = `<h1>${newProject.title}</h1><p>Input raw material specifications and craft notes to shape a refined editorial product narrative.</p>`;
      }
    }

    // Initialize version history snapshot
    newProject.versionHistory = [
      {
        id: `ver-${Date.now()}-init`,
        versionNumber: 1,
        projectId: newProject.id,
        type: 'manual_save',
        label: 'Initial Draft Created',
        timestamp: now,
        wordCount: countWords(newProject.content),
        characterCount: extractPlainTextFromHtml(newProject.content).length,
        content: newProject.content,
        structuredState: {
          title: newProject.title,
          projectType: newProject.type,
          brief: newProject.brief,
          outline: newProject.outline,
          contentRules: newProject.contentRules,
          writingControls: newProject.writingControls,
          articleMeta: newProject.articleMeta,
          giftGuideMeta: newProject.giftGuideMeta,
          productCopyMeta: newProject.productCopyMeta,
        },
      },
    ];

    this.saveProject(newProject);
    return newProject;
  },

  getGlobalModel(): ModelId {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_GLOBAL_MODEL);
      if (stored && stored in MODEL_REGISTRY) {
        return stored as ModelId;
      }
    } catch (e) {
      console.warn('Failed to read global model from localStorage:', e);
    }
    return DEFAULT_GLOBAL_MODEL_ID;
  },

  setGlobalModel(modelId: ModelId): void {
    try {
      if (modelId in MODEL_REGISTRY) {
        localStorage.setItem(STORAGE_KEY_GLOBAL_MODEL, modelId);
      }
    } catch (e) {
      console.error('Failed to save global model to localStorage:', e);
    }
  },

  getActiveProjectId(): string | null {
    return localStorage.getItem(STORAGE_KEY_ACTIVE_PROJECT_ID);
  },

  setActiveProjectId(id: string | null): void {
    if (id) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_PROJECT_ID, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_PROJECT_ID);
    }
  },

  getRawGlobalInstructionsIncludingDeleted(): GlobalInstruction[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_GLOBAL_RULES);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to read global rules from localStorage:', e);
    }
    const seed = DEFAULT_GLOBAL_INSTRUCTIONS;
    this.saveRawGlobalInstructions(seed);
    return seed;
  },

  getGlobalInstructions(): GlobalInstruction[] {
    return this.getRawGlobalInstructionsIncludingDeleted().filter((g) => !g._isDeleted);
  },

  saveRawGlobalInstructions(rules: GlobalInstruction[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_GLOBAL_RULES, JSON.stringify(rules));
    } catch (e) {
      console.error('Failed to save global rules:', e);
    }
    indexedDBService.putMany(STORES.GLOBAL_INSTRUCTIONS, rules).catch((err) => {
      console.warn('Async IndexedDB saveRawGlobalInstructions error:', err);
    });
    this.notifyListeners();
  },

  saveGlobalInstructions(rules: GlobalInstruction[]): void {
    const localRaw = this.getRawGlobalInstructionsIncludingDeleted();
    const tombstones = localRaw.filter((g) => g._isDeleted);
    const tombstoneMap = new Map(tombstones.map((t) => [t.id, t]));

    const mergedMap = new Map<string, GlobalInstruction>();
    rules.forEach((g) => mergedMap.set(g.id, { ...g, _isDeleted: false }));
    tombstoneMap.forEach((tomb, id) => {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, tomb);
      }
    });
    this.saveRawGlobalInstructions(Array.from(mergedMap.values()));
  },

  saveGlobalInstructionsFromRemote(rules: GlobalInstruction[]): void {
    const localRaw = this.getRawGlobalInstructionsIncludingDeleted();
    const merged = mergeWithTombstones(localRaw, rules);
    this.saveRawGlobalInstructions(merged);
  },

  deleteGlobalInstruction(id: string): void {
    const localRaw = this.getRawGlobalInstructionsIncludingDeleted();
    const now = new Date().toISOString();
    const existingIndex = localRaw.findIndex((g) => g.id === id);
    let updated: GlobalInstruction[];

    if (existingIndex >= 0) {
      updated = [...localRaw];
      updated[existingIndex] = {
        ...updated[existingIndex],
        _isDeleted: true,
        deletedAt: now,
      };
    } else {
      updated = [
        ...localRaw,
        {
          id,
          text: 'Deleted Instruction',
          category: 'constraint',
          enabled: false,
          _isDeleted: true,
          deletedAt: now,
        },
      ];
    }

    this.saveRawGlobalInstructions(updated);
    try {
      if (typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.deleteRecord === 'function') {
        syncEngine.deleteRecord('global_instructions', id);
      }
    } catch (e) {
      console.warn('SyncEngine deleteRecord notice:', e);
    }
  },

  saveSettingsFromRemote(settings: { activeProjectId?: string; activeTheme?: any; globalAiModel?: any }): void {
    if (settings.activeProjectId !== undefined) {
      this.setActiveProjectId(settings.activeProjectId);
    }
    if (settings.activeTheme) {
      this.setTheme(settings.activeTheme);
    }
    if (settings.globalAiModel) {
      this.setGlobalModel(settings.globalAiModel);
    }
  },

  resetGlobalInstructions(): GlobalInstruction[] {
    this.saveGlobalInstructions(DEFAULT_GLOBAL_INSTRUCTIONS);
    return DEFAULT_GLOBAL_INSTRUCTIONS;
  },

  // ==========================================
  // THEME PERSISTENCE (Phase 3)
  // ==========================================
  getTheme(): ThemeId {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_THEME);
      if (stored && ['default', 'editorial', 'minimal', 'classic', 'warm', 'dark_editorial'].includes(stored)) {
        return stored as ThemeId;
      }
    } catch (e) {
      console.warn('Failed to read theme from localStorage:', e);
    }
    return 'default';
  },

  setTheme(theme: ThemeId): void {
    try {
      localStorage.setItem(STORAGE_KEY_THEME, theme);
    } catch (e) {
      console.error('Failed to save theme:', e);
    }
    indexedDBService.put(STORES.SETTINGS, { key: 'theme', value: theme }).catch((err) => {
      console.warn('Async IndexedDB setTheme error:', err);
    });
    this.notifyListeners();
  },

  // ==========================================
  // STYLE REFERENCE PROFILES (Phase 3)
  // ==========================================
  // ==========================================
  // STYLE REFERENCE PROFILES (Phase 3)
  // ==========================================
  getRawStyleProfilesIncludingDeleted(): StyleProfile[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_STYLE_PROFILES);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to read style profiles from localStorage:', e);
    }
    const seed = DEFAULT_SEED_STYLE_PROFILES;
    this.saveRawStyleProfiles(seed);
    return seed;
  },

  getStyleProfiles(): StyleProfile[] {
    return this.getRawStyleProfilesIncludingDeleted().filter((p) => !p._isDeleted);
  },

  getStyleProfile(id: string): StyleProfile | null {
    const list = this.getStyleProfiles();
    return list.find((p) => p.id === id) || null;
  },

  saveRawStyleProfiles(profiles: StyleProfile[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_STYLE_PROFILES, JSON.stringify(profiles));
    } catch (e) {
      console.error('Failed to save style profiles:', e);
    }
    indexedDBService.putMany(STORES.STYLE_PROFILES, profiles).catch((err) => {
      console.warn('Async IndexedDB saveRawStyleProfiles error:', err);
    });
    this.notifyListeners();
  },

  saveStyleProfile(profile: StyleProfile): void {
    const list = this.getRawStyleProfilesIncludingDeleted();
    const existingIndex = list.findIndex((p) => p.id === profile.id);
    const updated = [...list];
    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      updated[existingIndex] = {
        ...profile,
        _isDeleted: false,
        updatedAt: now,
      };
    } else {
      updated.push({
        ...profile,
        _isDeleted: false,
        createdAt: profile.createdAt || now,
        updatedAt: now,
      });
    }
    this.saveRawStyleProfiles(updated);
  },

  saveStyleProfiles(profiles: StyleProfile[]): void {
    const localRaw = this.getRawStyleProfilesIncludingDeleted();
    const tombstones = localRaw.filter((p) => p._isDeleted);
    const tombstoneMap = new Map(tombstones.map((t) => [t.id, t]));

    const mergedMap = new Map<string, StyleProfile>();
    profiles.forEach((p) => mergedMap.set(p.id, { ...p, _isDeleted: false }));
    tombstoneMap.forEach((tomb, id) => {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, tomb);
      }
    });
    this.saveRawStyleProfiles(Array.from(mergedMap.values()));
  },

  saveStyleProfilesFromRemote(profiles: StyleProfile[]): void {
    const localRaw = this.getRawStyleProfilesIncludingDeleted();
    const merged = mergeWithTombstones(localRaw, profiles);
    this.saveRawStyleProfiles(merged);
  },

  deleteStyleProfile(id: string): void {
    const localRaw = this.getRawStyleProfilesIncludingDeleted();
    const now = new Date().toISOString();
    const existingIndex = localRaw.findIndex((p) => p.id === id);
    let updated: StyleProfile[];

    if (existingIndex >= 0) {
      updated = [...localRaw];
      updated[existingIndex] = {
        ...updated[existingIndex],
        _isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      };
    } else {
      updated = [
        ...localRaw,
        {
          id,
          name: 'Deleted Profile',
          description: '',
          samples: [],
          generatedInstructions: [],
          userEditedInstructions: [],
          hasUserEdited: false,
          isActive: false,
          createdAt: now,
          updatedAt: now,
          _isDeleted: true,
          deletedAt: now,
        },
      ];
    }

    this.saveRawStyleProfiles(updated);
    try {
      if (typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.deleteRecord === 'function') {
        syncEngine.deleteRecord('style_profiles', id);
      }
    } catch (e) {
      console.warn('SyncEngine deleteRecord notice:', e);
    }
  },

  // ==========================================
  // INTERNAL LINK LIBRARY (Phase 4)
  // ==========================================
  getRawInternalLinksIncludingDeleted(): InternalLink[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_INTERNAL_LINKS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const existingIds = new Set(parsed.map((l: any) => l.id));
          const existingUrls = new Set(parsed.map((l: any) => l.url));
          let changed = false;

          const migrated = parsed.map((l: any) => {
            if (!l.destinationType) {
              changed = true;
              return {
                ...l,
                destinationType: inferDestinationType(l.url, l.title),
              };
            }
            return l;
          });

          // Merge any seed destinations not yet present
          for (const seed of DEFAULT_SEED_INTERNAL_LINKS) {
            if (!existingIds.has(seed.id) && !existingUrls.has(seed.url)) {
              migrated.push(seed);
              changed = true;
            }
          }

          if (changed) {
            this.saveRawInternalLinks(migrated);
          }
          return migrated;
        }
      }
    } catch (e) {
      console.warn('Failed to read internal links from localStorage:', e);
    }
    const seed = DEFAULT_SEED_INTERNAL_LINKS;
    this.saveRawInternalLinks(seed);
    return seed;
  },

  getInternalLinks(): InternalLink[] {
    return this.getRawInternalLinksIncludingDeleted().filter((l) => !l._isDeleted);
  },

  getInternalLink(id: string): InternalLink | null {
    const list = this.getInternalLinks();
    return list.find((l) => l.id === id) || null;
  },

  saveRawInternalLinks(links: InternalLink[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_INTERNAL_LINKS, JSON.stringify(links));
    } catch (e) {
      console.error('Failed to save internal links:', e);
    }
    indexedDBService.putMany(STORES.INTERNAL_LINKS, links).catch((err) => {
      console.warn('Async IndexedDB saveRawInternalLinks error:', err);
    });
    this.notifyListeners();
  },

  saveInternalLink(link: InternalLink): void {
    const rawList = this.getRawInternalLinksIncludingDeleted();
    const existingIndex = rawList.findIndex((l) => l.id === link.id);
    const updated = [...rawList];
    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      updated[existingIndex] = {
        ...link,
        _isDeleted: false,
        updatedAt: now,
      };
    } else {
      updated.push({
        ...link,
        _isDeleted: false,
        createdAt: link.createdAt || now,
        updatedAt: now,
      });
    }
    this.saveRawInternalLinks(updated);
  },

  saveInternalLinks(links: InternalLink[]): void {
    const localRaw = this.getRawInternalLinksIncludingDeleted();
    const tombstones = localRaw.filter((l) => l._isDeleted);
    const tombstoneMap = new Map(tombstones.map((t) => [t.id, t]));

    const mergedMap = new Map<string, InternalLink>();
    links.forEach((l) => mergedMap.set(l.id, { ...l, _isDeleted: false }));
    tombstoneMap.forEach((tomb, id) => {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, tomb);
      }
    });
    this.saveRawInternalLinks(Array.from(mergedMap.values()));
  },

  saveInternalLinksFromRemote(links: InternalLink[]): void {
    const localRaw = this.getRawInternalLinksIncludingDeleted();
    const merged = mergeWithTombstones(localRaw, links);
    this.saveRawInternalLinks(merged);
  },

  deleteInternalLink(id: string): void {
    const localRaw = this.getRawInternalLinksIncludingDeleted();
    const now = new Date().toISOString();
    const existingIndex = localRaw.findIndex((l) => l.id === id);
    let updated: InternalLink[];

    if (existingIndex >= 0) {
      updated = [...localRaw];
      updated[existingIndex] = {
        ...updated[existingIndex],
        _isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      };
    } else {
      updated = [
        ...localRaw,
        {
          id,
          title: 'Deleted Link',
          url: '',
          topic: '',
          description: '',
          category: 'General',
          active: false,
          createdAt: now,
          updatedAt: now,
          _isDeleted: true,
          deletedAt: now,
        },
      ];
    }

    this.saveRawInternalLinks(updated);
    try {
      if (typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.deleteRecord === 'function') {
        syncEngine.deleteRecord('internal_links', id);
      }
    } catch (e) {
      console.warn('SyncEngine deleteRecord notice:', e);
    }
  },

  // ==========================================
  // LINK CATEGORIES (Phase 4)
  // ==========================================
  getLinkCategories(): string[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_LINK_CATEGORIES);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to read link categories from localStorage:', e);
    }
    const seed = DEFAULT_LINK_CATEGORIES;
    this.saveLinkCategories(seed);
    return seed;
  },

  saveLinkCategories(categories: string[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_LINK_CATEGORIES, JSON.stringify(categories));
    } catch (e) {
      console.error('Failed to save link categories:', e);
    }
  },

  addLinkCategory(category: string): void {
    const trimmed = category.trim();
    if (!trimmed) return;
    const list = this.getLinkCategories();
    if (!list.includes(trimmed)) {
      this.saveLinkCategories([...list, trimmed]);
    }
  },

  deleteLinkCategory(category: string): void {
    const list = this.getLinkCategories();
    const filtered = list.filter((c) => c !== category);
    this.saveLinkCategories(filtered);
  },

  // Phase 10.5: Saved Ideas System
  // Phase 10.5: Saved Ideas System
  getRawSavedIdeasIncludingDeleted(): SavedEditorialIdea[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SAVED_IDEAS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Failed to parse saved ideas from localStorage:', e);
      return [];
    }
  },

  getSavedIdeas(): SavedEditorialIdea[] {
    return this.getRawSavedIdeasIncludingDeleted().filter((i) => !i._isDeleted);
  },

  saveRawSavedIdeas(ideas: SavedEditorialIdea[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_SAVED_IDEAS, JSON.stringify(ideas));
    } catch (e) {
      console.error('Failed to save ideas to localStorage:', e);
    }
    indexedDBService.putMany(STORES.SAVED_IDEAS, ideas).catch((err) => {
      console.warn('Async IndexedDB saveRawSavedIdeas error:', err);
    });
    this.notifyListeners();
  },

  saveSavedIdeas(ideas: SavedEditorialIdea[]): void {
    const localRaw = this.getRawSavedIdeasIncludingDeleted();
    const tombstones = localRaw.filter((i) => i._isDeleted);
    const tombstoneMap = new Map(tombstones.map((t) => [t.id, t]));

    const mergedMap = new Map<string, SavedEditorialIdea>();
    ideas.forEach((i) => mergedMap.set(i.id, { ...i, _isDeleted: false }));
    tombstoneMap.forEach((tomb, id) => {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, tomb);
      }
    });
    this.saveRawSavedIdeas(Array.from(mergedMap.values()));
  },

  saveSavedIdeasFromRemote(ideas: SavedEditorialIdea[]): void {
    const localRaw = this.getRawSavedIdeasIncludingDeleted();
    const merged = mergeWithTombstones(localRaw, ideas);
    this.saveRawSavedIdeas(merged);
  },

  saveSavedIdea(idea: SavedEditorialIdea): boolean {
    const list = this.getSavedIdeas();
    // Duplicate detection: compare normalized title + angle
    const normalize = (s: string) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const isDup = list.some(
      (existing) =>
        normalize(existing.title) === normalize(idea.title) &&
        normalize(existing.angle) === normalize(idea.angle)
    );
    if (isDup) {
      return false; // already saved
    }
    const rawList = this.getRawSavedIdeasIncludingDeleted();
    const updated = [{ ...idea, _isDeleted: false, savedAt: idea.savedAt || new Date().toISOString() }, ...rawList];
    this.saveRawSavedIdeas(updated);
    return true;
  },

  deleteSavedIdea(id: string): void {
    const localRaw = this.getRawSavedIdeasIncludingDeleted();
    const now = new Date().toISOString();
    const existingIndex = localRaw.findIndex((item) => item.id === id);
    let updated: SavedEditorialIdea[];

    if (existingIndex >= 0) {
      updated = [...localRaw];
      updated[existingIndex] = {
        ...updated[existingIndex],
        _isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      };
    } else {
      updated = [
        ...localRaw,
        {
          id,
          title: 'Deleted Idea',
          angle: '',
          whyInteresting: '',
          originalTopic: '',
          goal: 'Informational',
          ideaStyle: 'Mixed',
          savedAt: now,
          updatedAt: now,
          _isDeleted: true,
          deletedAt: now,
        },
      ];
    }

    this.saveRawSavedIdeas(updated);
    try {
      if (typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.deleteRecord === 'function') {
        syncEngine.deleteRecord('saved_ideas', id);
      }
    } catch (e) {
      console.warn('SyncEngine deleteRecord notice:', e);
    }
  },

  isIdeaSaved(title: string, angle: string): boolean {
    const list = this.getSavedIdeas();
    const normalize = (s: string) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    return list.some(
      (existing) =>
        normalize(existing.title) === normalize(title) &&
        normalize(existing.angle) === normalize(angle)
    );
  },

  // ==========================================
  // STORAGE CHANGE SUBSCRIBERS
  // ==========================================
  subscribe(callback: () => void): () => void {
    storageListeners.add(callback);
    return () => storageListeners.delete(callback);
  },

  notifyListeners(): void {
    storageListeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('Storage listener callback error:', err);
      }
    });
  },

  // ==========================================
  // RESEARCH REPOSITORY (Studies, Claims, Files)
  // ==========================================
  getRawResearchStudiesIncludingDeleted(): ResearchStudy[] {
    let list: ResearchStudy[] = [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY_RESEARCH_STUDIES);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          list = parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to read research studies from localStorage:', e);
    }
    if (list.length === 0) {
      list = DEFAULT_SEED_RESEARCH_STUDIES;
      this.saveRawResearchStudies(list);
    }
    return list.map((s) => ({
      ...s,
      publication: s.publication || s.sourceOrPublisher || '',
      publicationYear: s.publicationYear || (s.publicationDate ? s.publicationDate.slice(0, 4) : ''),
      doi: s.doi || (s.doiOrUrl?.includes('10.') ? s.doiOrUrl : ''),
      sourceUrl: s.sourceUrl || s.doiOrUrl || '',
      abstract: s.abstract || s.summary || '',
      dateAdded: s.dateAdded || s.createdAt || new Date().toISOString(),
      analysisStatus: s.analysisStatus || (s.analysis ? 'analyzed' : 'unanalyzed'),
      claims: s.claims || [],
      tags: Array.isArray(s.tags) ? s.tags : [],
    }));
  },

  getResearchStudies(): ResearchStudy[] {
    return this.getRawResearchStudiesIncludingDeleted().filter((s) => !s._isDeleted);
  },

  getResearchStudy(id: string): ResearchStudy | null {
    const list = this.getResearchStudies();
    return list.find((s) => s.id === id) || null;
  },

  saveRawResearchStudies(studies: ResearchStudy[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_RESEARCH_STUDIES, JSON.stringify(studies));
    } catch (e) {
      console.error('Failed to save research studies to localStorage:', e);
    }
    indexedDBService.putMany(STORES.RESEARCH_STUDIES, studies).catch((err) => {
      console.warn('Async IndexedDB saveRawResearchStudies error:', err);
    });
    this.notifyListeners();
  },

  saveResearchStudies(studies: ResearchStudy[]): void {
    const localRaw = this.getRawResearchStudiesIncludingDeleted();
    const tombstones = localRaw.filter((s) => s._isDeleted);
    const tombstoneMap = new Map(tombstones.map((t) => [t.id, t]));

    const mergedMap = new Map<string, ResearchStudy>();
    studies.forEach((s) => mergedMap.set(s.id, { ...s, _isDeleted: false }));
    tombstoneMap.forEach((tomb, id) => {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, tomb);
      }
    });
    this.saveRawResearchStudies(Array.from(mergedMap.values()));
  },

  saveResearchStudiesFromRemote(studies: ResearchStudy[]): void {
    const localRaw = this.getRawResearchStudiesIncludingDeleted();
    const merged = mergeWithTombstones(localRaw, studies);
    this.saveRawResearchStudies(merged);
  },

  saveResearchStudy(study: ResearchStudy): void {
    const rawList = this.getRawResearchStudiesIncludingDeleted();
    const existingIndex = rawList.findIndex((s) => s.id === study.id);
    const updated = [...rawList];
    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      updated[existingIndex] = { ...study, _isDeleted: false, updatedAt: now };
    } else {
      updated.push({
        ...study,
        _isDeleted: false,
        createdAt: study.createdAt || now,
        updatedAt: now,
      });
    }
    this.saveRawResearchStudies(updated);
  },

  deleteResearchStudy(id: string): void {
    console.log('[Storage] deleteResearchStudy invoked for ID:', id);
    const localRaw = this.getRawResearchStudiesIncludingDeleted();
    const now = new Date().toISOString();
    const existingIndex = localRaw.findIndex((s) => s.id === id);
    let updated: ResearchStudy[];

    if (existingIndex >= 0) {
      updated = [...localRaw];
      updated[existingIndex] = {
        ...updated[existingIndex],
        _isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      };
      console.log('[Storage] Marked existing research study as deleted (tombstone):', id);
    } else {
      updated = [
        ...localRaw,
        {
          id,
          title: 'Deleted Study',
          authors: [],
          tags: [],
          dateAdded: now,
          analysisStatus: 'unanalyzed',
          createdAt: now,
          updatedAt: now,
          _isDeleted: true,
          deletedAt: now,
        },
      ];
      console.log('[Storage] Created new tombstone for missing research study ID:', id);
    }

    this.saveRawResearchStudies(updated);
    console.log('[Storage] saveRawResearchStudies completed successfully for ID:', id);
    try {
      if (typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.deleteRecord === 'function') {
        syncEngine.deleteRecord('research_studies', id);
        console.log('[Storage] syncEngine.deleteRecord called for study ID:', id);
      }
    } catch (e) {
      console.warn('[Storage] SyncEngine deleteRecord notice:', e);
    }
  },

  getRawResearchClaimsIncludingDeleted(): ResearchClaim[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_RESEARCH_CLAIMS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to read research claims from localStorage:', e);
    }
    const seed = DEFAULT_SEED_RESEARCH_CLAIMS;
    this.saveRawResearchClaims(seed);
    return seed;
  },

  getResearchClaims(): ResearchClaim[] {
    return this.getRawResearchClaimsIncludingDeleted().filter((c) => !c._isDeleted);
  },

  saveRawResearchClaims(claims: ResearchClaim[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_RESEARCH_CLAIMS, JSON.stringify(claims));
    } catch (e) {
      console.error('Failed to save research claims to localStorage:', e);
    }
    indexedDBService.putMany(STORES.RESEARCH_CLAIMS, claims).catch((err) => {
      console.warn('Async IndexedDB saveRawResearchClaims error:', err);
    });
    this.notifyListeners();
  },

  saveResearchClaims(claims: ResearchClaim[]): void {
    const localRaw = this.getRawResearchClaimsIncludingDeleted();
    const tombstones = localRaw.filter((c) => c._isDeleted);
    const tombstoneMap = new Map(tombstones.map((t) => [t.id, t]));

    const mergedMap = new Map<string, ResearchClaim>();
    claims.forEach((c) => mergedMap.set(c.id, { ...c, _isDeleted: false }));
    tombstoneMap.forEach((tomb, id) => {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, tomb);
      }
    });
    this.saveRawResearchClaims(Array.from(mergedMap.values()));
  },

  saveResearchClaimsFromRemote(claims: ResearchClaim[]): void {
    const localRaw = this.getRawResearchClaimsIncludingDeleted();
    const merged = mergeWithTombstones(localRaw, claims);
    this.saveRawResearchClaims(merged);
  },

  saveResearchClaim(claim: ResearchClaim): void {
    const rawList = this.getRawResearchClaimsIncludingDeleted();
    const existingIndex = rawList.findIndex((c) => c.id === claim.id);
    const updated = [...rawList];
    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      updated[existingIndex] = { ...claim, _isDeleted: false, updatedAt: now };
    } else {
      updated.push({
        ...claim,
        _isDeleted: false,
        createdAt: claim.createdAt || now,
        updatedAt: now,
      });
    }
    this.saveRawResearchClaims(updated);
  },

  deleteResearchClaim(id: string): void {
    const localRaw = this.getRawResearchClaimsIncludingDeleted();
    const now = new Date().toISOString();
    const existingIndex = localRaw.findIndex((c) => c.id === id);
    let updated: ResearchClaim[];

    if (existingIndex >= 0) {
      updated = [...localRaw];
      updated[existingIndex] = {
        ...updated[existingIndex],
        _isDeleted: true,
        deletedAt: now,
        updatedAt: now,
      };
    } else {
      updated = [
        ...localRaw,
        {
          id,
          studyId: '',
          claimText: 'Deleted Claim',
          claimType: 'source_fact',
          supportedBySource: '',
          confidence: 'high',
          createdAt: now,
          updatedAt: now,
          _isDeleted: true,
          deletedAt: now,
        },
      ];
    }

    this.saveRawResearchClaims(updated);
    try {
      if (typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.deleteRecord === 'function') {
        syncEngine.deleteRecord('research_claims', id);
      }
    } catch (e) {
      console.warn('SyncEngine deleteRecord notice:', e);
    }
  },

  getResearchFiles(): ResearchFile[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_RESEARCH_FILES);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to read research files from localStorage:', e);
    }
    const seed = DEFAULT_SEED_RESEARCH_FILES;
    this.saveResearchFiles(seed);
    return seed;
  },

  saveResearchFiles(files: ResearchFile[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_RESEARCH_FILES, JSON.stringify(files));
    } catch (e) {
      console.error('Failed to save research files to localStorage:', e);
    }
    indexedDBService.putMany(STORES.RESEARCH_FILES, files).catch((err) => {
      console.warn('Async IndexedDB saveResearchFiles error:', err);
    });
    this.notifyListeners();
  },

  saveResearchFile(file: ResearchFile): void {
    const list = this.getResearchFiles();
    const existingIndex = list.findIndex((f) => f.id === file.id);
    const updated = [...list];
    if (existingIndex >= 0) {
      updated[existingIndex] = file;
    } else {
      updated.push(file);
    }
    this.saveResearchFiles(updated);
  },

  deleteResearchFile(id: string): void {
    const list = this.getResearchFiles();
    const filtered = list.filter((f) => f.id !== id);
    this.saveResearchFiles(filtered);
    indexedDBService.delete(STORES.RESEARCH_FILES, id).catch((err) => {
      console.warn('Async IndexedDB deleteResearchFile error:', err);
    });
  },

  // ==========================================
  // BACKUP METADATA
  // ==========================================
  getLastBackupTimestamp(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY_LAST_BACKUP);
    } catch (e) {
      return null;
    }
  },

  setLastBackupTimestamp(iso: string): void {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_BACKUP, iso);
    } catch (e) {
      console.error('Failed to save last backup timestamp:', e);
    }
    indexedDBService.put(STORES.SETTINGS, { key: 'lastBackupTimestamp', value: iso }).catch((err) => {
      console.warn('Async IndexedDB setLastBackupTimestamp error:', err);
    });
    this.notifyListeners();
  },

  // ==========================================
  // INDEXEDDB HYDRATION & LIFECYCLE
  // ==========================================
  async init(): Promise<void> {
    if (!indexedDBService.checkAvailability()) {
      console.info('IndexedDB is not supported; running on localStorage cache.');
      return;
    }

    try {
      const projectCount = await indexedDBService.count(STORES.PROJECTS);
      if (projectCount === 0) {
        // First run or empty IndexedDB: seed from localStorage/defaults
        const projects = this.getProjects();
        const styleProfiles = this.getStyleProfiles();
        const internalLinks = this.getInternalLinks();
        const globalInstructions = this.getGlobalInstructions();
        const researchStudies = this.getResearchStudies();
        const researchClaims = this.getResearchClaims();
        const researchFiles = this.getResearchFiles();
        const savedIdeas = this.getSavedIdeas();

        await Promise.all([
          indexedDBService.putMany(STORES.PROJECTS, projects),
          indexedDBService.putMany(STORES.STYLE_PROFILES, styleProfiles),
          indexedDBService.putMany(STORES.INTERNAL_LINKS, internalLinks),
          indexedDBService.putMany(STORES.GLOBAL_INSTRUCTIONS, globalInstructions),
          indexedDBService.putMany(STORES.RESEARCH_STUDIES, researchStudies),
          indexedDBService.putMany(STORES.RESEARCH_CLAIMS, researchClaims),
          indexedDBService.putMany(STORES.RESEARCH_FILES, researchFiles),
          indexedDBService.putMany(STORES.SAVED_IDEAS, savedIdeas),
          indexedDBService.put(STORES.SETTINGS, { key: 'theme', value: this.getTheme() }),
          indexedDBService.put(STORES.SETTINGS, { key: 'globalModel', value: this.getGlobalModel() }),
        ]);
        console.info('IndexedDB initialized & populated with durable studio data.');
      } else {
        // IndexedDB already contains data: hydrate cache from IndexedDB while preserving newer local edits
        const idbProjects = await indexedDBService.getAll<WritingProject>(STORES.PROJECTS);
        if (idbProjects.length > 0) {
          const currentLocal = this.getRawProjectsIncludingDeleted();
          const mergedProjects = mergeWithTombstones(currentLocal, idbProjects);
          localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(mergedProjects));
        }
        const idbProfiles = await indexedDBService.getAll<StyleProfile>(STORES.STYLE_PROFILES);
        if (idbProfiles.length > 0) {
          localStorage.setItem(STORAGE_KEY_STYLE_PROFILES, JSON.stringify(idbProfiles));
        }
        const idbLinks = await indexedDBService.getAll<InternalLink>(STORES.INTERNAL_LINKS);
        if (idbLinks.length > 0) {
          localStorage.setItem(STORAGE_KEY_INTERNAL_LINKS, JSON.stringify(idbLinks));
        }
        const idbInstructions = await indexedDBService.getAll<GlobalInstruction>(STORES.GLOBAL_INSTRUCTIONS);
        if (idbInstructions.length > 0) {
          localStorage.setItem(STORAGE_KEY_GLOBAL_RULES, JSON.stringify(idbInstructions));
        }
        const idbStudies = await indexedDBService.getAll<ResearchStudy>(STORES.RESEARCH_STUDIES);
        if (idbStudies.length > 0) {
          localStorage.setItem(STORAGE_KEY_RESEARCH_STUDIES, JSON.stringify(idbStudies));
        }
        const idbClaims = await indexedDBService.getAll<ResearchClaim>(STORES.RESEARCH_CLAIMS);
        if (idbClaims.length > 0) {
          localStorage.setItem(STORAGE_KEY_RESEARCH_CLAIMS, JSON.stringify(idbClaims));
        }
        const idbFiles = await indexedDBService.getAll<ResearchFile>(STORES.RESEARCH_FILES);
        if (idbFiles.length > 0) {
          localStorage.setItem(STORAGE_KEY_RESEARCH_FILES, JSON.stringify(idbFiles));
        }
        const idbIdeas = await indexedDBService.getAll<SavedEditorialIdea>(STORES.SAVED_IDEAS);
        if (idbIdeas.length > 0) {
          localStorage.setItem(STORAGE_KEY_SAVED_IDEAS, JSON.stringify(idbIdeas));
        }
        const idbSettings = await indexedDBService.getAll<{ key: string; value: any }>(STORES.SETTINGS);
        for (const item of idbSettings) {
          if (item.key === 'lastBackupTimestamp' && item.value) {
            localStorage.setItem(STORAGE_KEY_LAST_BACKUP, item.value);
          }
          if (item.key === 'theme' && item.value) {
            localStorage.setItem(STORAGE_KEY_THEME, item.value);
          }
          if (item.key === 'globalModel' && item.value) {
            localStorage.setItem(STORAGE_KEY_GLOBAL_MODEL, item.value);
          }
        }
        this.notifyListeners();
      }
    } catch (err) {
      console.warn('Error during IndexedDB initialization:', err);
    }
  },
};

export const DEFAULT_SEED_RESEARCH_STUDIES: ResearchStudy[] = [
  {
    id: 'study-tactile-psychology',
    title: 'The Psychology of Material Permanence: How Tactile Artifacts Foster Emotional Longevity',
    authors: ['Dr. Arthur Campbell', 'Dr. Evelyn Vance'],
    publication: 'Journal of Material Culture & Craft Psychology',
    sourceOrPublisher: 'Journal of Material Culture & Craft Psychology',
    publicationYear: 2024,
    publicationDate: '2024-03-15',
    doi: '10.1016/j.matcult.2024.03.012',
    doiOrUrl: 'https://doi.org/10.1016/j.matcult.2024.03.012',
    sourceUrl: 'https://doi.org/10.1016/j.matcult.2024.03.012',
    abstract: 'A longitudinal investigation comparing consumer attachment to disposable digital novelties versus bench-made mechanical objects crafted from honest materials (turned brass, canvas, cast iron). Demonstrates how maintenance rituals act as psychological anchors in domestic environments.',
    summary: 'A longitudinal investigation comparing consumer attachment to disposable digital novelties versus bench-made mechanical objects crafted from honest materials (turned brass, canvas, cast iron).',
    keyFindings: [
      'Objects requiring active tactile maintenance (winding, oiling, seasoning) yield 4.2x greater sentimental attachment after 36 months.',
      'Gifts chosen for structural serviceability produce enduring gratitude, whereas novelty gifts suffer a 78% drop in perceived value within 90 days.',
      'Recipients consistently describe repairable objects as "grounding" in screen-saturated domestic environments.',
    ],
    methodology: 'Longitudinal panel study tracking 1,240 gift recipients across 36 months with biometric engagement and psychological recall surveys.',
    tags: ['Gifting Psychology', 'Material Permanence', 'Tactile Rituals', 'Longevity'],
    dateAdded: '2026-10-01T12:00:00.000Z',
    dateAnalyzed: '2026-10-01T14:30:00.000Z',
    analysisStatus: 'analyzed',
    fileId: 'file-tactile-whitepaper',
    fileName: 'tactile_permanence_whitepaper_2024.txt',
    attachedFileIds: ['file-tactile-whitepaper'],
    notes: 'Primary foundational reference on why repairable bench construction beats disposable tech novelties.',
    analysis: {
      id: 'analysis-tactile-1',
      studyId: 'study-tactile-psychology',
      analyzedAt: '2026-10-01T14:30:00.000Z',
      modelUsed: 'gemini-3.8-flash',
      whatWasStudied: 'Investigated whether physical objects that demand active, manual maintenance (winding, conditioning, sharpening) generate deeper and more durable recipient attachment than passive conveniences or digital novelties.',
      whatTheStudyFound: [
        'Objects requiring active tactile participation yielded 4.2x greater sentimental attachment over 36 months.',
        'Novelty gifts lacking serviceability suffered a 78% drop in perceived emotional value within the first 90 days.',
        'Participants described physical repairability as a feeling of "grounding" amid screen-saturated domestic routines.',
      ],
      whatItMeans: 'For Science of Gifts, this justifies our editorial focus on objects of tangible permanence: the best gifts are not those that eliminate all friction, but those whose gentle maintenance rituals weave them permanently into the recipient’s daily life.',
      whatItDoesNotEstablish: [
        'Does not establish that all handmade items are structurally superior or reliable.',
        'Correlation between tactile maintenance and gratitude does not hold if the tool fails at its primary utilitarian function.',
        'Findings reflect domestic tool and writing instrument panels; cannot be automatically generalized to perishable luxuries.',
      ],
      methodology: '36-month longitudinal tracking of 1,240 adult gift recipients in Western Europe and North America with biannual sentiment surveys and physical usage logs.',
      limitations: [
        'Self-selection bias toward individuals who appreciate mechanical or analog craftsmanship.',
        'Sample confined to domestic and personal artifact categories; does not measure commercial equipment.',
      ],
      editorialUse: [
        'Legitimately supports arguments that mechanical and repairable gifts communicate deep, unhurried thoughtfulness.',
        'Justifies excluding disposable, battery-sealed items from heirloom gift guides.',
        'Provides empirical weight to descriptions of brass, cast iron, and oak bark leather.',
      ],
      potentialArticleIdeas: [
        {
          title: 'The 36-Month Gift: Why Things You Have to Oil, Wind, or Season Never Get Forgotten',
          angle: 'Examining why objects requiring active maintenance foster deeper psychological roots than convenience novelties.',
          whyInteresting: 'Directly backed by longitudinal data tracking over a thousand recipients across three years.',
          searchIntent: 'Psychological Gifting Insight',
        },
      ],
    },
    claims: [
      {
        id: 'claim-1',
        studyId: 'study-tactile-psychology',
        studyTitle: 'The Psychology of Material Permanence',
        claimText: 'Recipients report 4.2x greater sentimental attachment to physical objects that require tactile ritual participation compared to disposable electronics.',
        claimType: 'source_fact',
        supportedBySource: 'Documented longitudinal panel analysis tracking recipient recall over 36 months.',
        context: 'Measured across domestic instruments, writing tools, and cast iron cookware.',
        confidence: 'high',
        relevantLimitation: 'Measured over 36 months; multi-decade heirloom status requires further study.',
        sourceReference: 'Campbell & Vance (2024), Journal of Material Culture & Craft Psychology',
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
      {
        id: 'claim-1b',
        studyId: 'study-tactile-psychology',
        studyTitle: 'The Psychology of Material Permanence',
        claimText: 'Gifts chosen for serviceability communicate deeper emotional respect than passive luxury novelties.',
        claimType: 'editorial_interpretation',
        supportedBySource: 'Qualitative interview analysis of recipient sentiment in Campbell & Vance (2024).',
        confidence: 'moderate',
        relevantLimitation: 'Editorial interpretation of participant qualitative interview transcripts.',
        sourceReference: 'Campbell & Vance (2024), Discussion Section',
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
    ],
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'study-reciprocity-utilitarian',
    title: 'Reciprocity and the Quiet Signal: Why Utilitarian Lineage Outlives Decorative Luxury',
    authors: ['Marcus Sterling', 'Helena Thorne'],
    publication: 'Quarterly Review of Social Anthropology & Material Studies',
    sourceOrPublisher: 'Quarterly Review of Social Anthropology & Material Studies',
    publicationYear: 2025,
    publicationDate: '2025-01-20',
    doi: '10.1177/002224292510293',
    doiOrUrl: 'https://doi.org/10.1177/002224292510293',
    sourceUrl: 'https://doi.org/10.1177/002224292510293',
    abstract: 'Examines social signalling and gift reception dynamics. Demonstrates that understated utilitarian tools communicate deep connoisseur observation, bypassing the awkward social pressure associated with flashy luxury brand symbols.',
    summary: 'Examines social signalling and gift reception dynamics. Demonstrates that understated utilitarian tools communicate deep connoisseur observation, bypassing the awkward social pressure associated with flashy luxury brand symbols.',
    keyFindings: [
      'Utilitarian tools with historical provenance generate minimal social friction and maximum daily utility.',
      'Recipients value gifts whose design reflects their specific daily routines 5.1x more than generic luxury listicle recommendations.',
      'Natural material patination acts as an emotional memory bank for the recipient over time.',
    ],
    methodology: 'Cross-cultural comparative analysis of gifting rituals and recipient sentiment in Western Europe and North America.',
    tags: ['Social Dynamics', 'Utilitarian Tools', 'Provenance', 'Gift Etiquette'],
    dateAdded: '2026-10-02T10:00:00.000Z',
    dateAnalyzed: '2026-10-02T11:15:00.000Z',
    analysisStatus: 'analyzed',
    attachedFileIds: [],
    notes: 'Essential reading on social signaling: why loud logos create awkward social debt while honest tools create quiet gratitude.',
    analysis: {
      id: 'analysis-reciprocity-1',
      studyId: 'study-reciprocity-utilitarian',
      analyzedAt: '2026-10-02T11:15:00.000Z',
      modelUsed: 'gemini-3.8-flash',
      whatWasStudied: 'Examined recipient emotional friction when receiving overt status-brand luxury gifts versus understated utilitarian tools with rich craft provenance.',
      whatTheStudyFound: [
        'Utilitarian tools with clear provenance generated the lowest recipient social anxiety and highest daily utilization rates.',
        'Gifts tied to specific observed daily rituals were rated 5.1x more thoughtful than generic luxury recommendations.',
        'Visible physical patination over time correlated directly with the recipient associating the object with the giver.',
      ],
      whatItMeans: 'Suggests that true connoisseurship in gift selection lies in quiet observation of the recipient\'s routine, not financial ostentation.',
      whatItDoesNotEstablish: [
        'Does not imply that luxury brands are universally disliked; in formal corporate rituals, status signals still dominate.',
        'Does not prove that utilitarian gifts succeed if the recipient has no personal interest in the underlying craft domain.',
      ],
      methodology: 'Ethnographic field observations and recipient sentiment surveys across 850 participants in the US, UK, and Germany.',
      limitations: [
        'Conducted primarily among urban professionals and craft enthusiasts.',
      ],
      editorialUse: [
        'Validates our anti-hype stance and rejection of superficial luxury brand lists.',
        'Provides language for explaining why an unadorned carbon steel knife or turned brass pen is a superior personal gift to a designer accessory.',
      ],
      potentialArticleIdeas: [
        {
          title: 'The Quiet Signal: Why the Best Gifts Never Carry a Conspicuous Logo',
          angle: 'How understated utilitarian tools communicate deep observation while bypassing the awkward debt of luxury branding.',
          whyInteresting: 'Bridges social psychology and material culture with actionable buyer etiquette.',
          searchIntent: 'Connoisseurship & Gift Etiquette',
        },
      ],
    },
    claims: [
      {
        id: 'claim-3',
        studyId: 'study-reciprocity-utilitarian',
        studyTitle: 'Reciprocity and the Quiet Signal',
        claimText: 'Objects constructed with exposed mechanical fasteners have an average operational lifespan exceeding 30 years compared to 3.2 years for adhesive-sealed assemblies.',
        claimType: 'source_fact',
        supportedBySource: 'Serviceability analysis in Sterling & Thorne (2025).',
        confidence: 'high',
        relevantLimitation: 'Applies to mechanical domestic tools with replacement part availability.',
        sourceReference: 'Sterling & Thorne (2025), Quarterly Review of Social Anthropology',
        createdAt: '2026-10-02T10:00:00.000Z',
        updatedAt: '2026-10-02T10:00:00.000Z',
      },
    ],
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  },
];

export const DEFAULT_SEED_RESEARCH_CLAIMS: ResearchClaim[] = [
  {
    id: 'claim-1',
    claimText: 'Recipients report 4.2x greater sentimental attachment to physical objects that require tactile ritual participation (such as daily winding or seasoning) compared to disposable electronics.',
    claimType: 'source_fact',
    studyId: 'study-tactile-psychology',
    studyTitle: 'The Psychology of Material Permanence',
    supportedBySource: 'Active interaction with physical escapements and mechanical joints establishes an enduring cognitive bond that passive consumer goods cannot replicate.',
    evidenceQuote: 'Active interaction with physical escapements and mechanical joints establishes an enduring cognitive bond that passive consumer goods cannot replicate.',
    confidence: 'high',
    tags: ['Psychology', 'Tactile', 'Attachment'],
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'claim-2',
    claimText: 'Vegetable-tanned bridle leather retains fiber density and structural tensile strength 60% longer under repeated humidity cycles than chromium-tanned alternatives.',
    claimType: 'source_fact',
    studyId: 'study-tactile-psychology',
    studyTitle: 'The Psychology of Material Permanence',
    supportedBySource: 'Bark tannin integration preserves natural collagen matrix cross-links, enabling gentle surface patination rather than surface cracking.',
    evidenceQuote: 'Bark tannin integration preserves natural collagen matrix cross-links, enabling gentle surface patination rather than surface cracking.',
    confidence: 'high',
    tags: ['Materials', 'Leather', 'Tensile Strength'],
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'claim-3',
    claimText: 'Objects constructed with exposed mechanical fasteners have an average operational lifespan exceeding 30 years compared to 3.2 years for adhesive-sealed assemblies.',
    claimType: 'source_fact',
    studyId: 'study-reciprocity-utilitarian',
    studyTitle: 'Reciprocity and the Quiet Signal',
    supportedBySource: 'Serviceability through standard hand tools completely alters the economic and psychological lifespan of domestic instruments.',
    evidenceQuote: 'Serviceability through standard hand tools completely alters the economic and psychological lifespan of domestic instruments.',
    confidence: 'high',
    tags: ['Mechanics', 'Fasteners', 'Repairability'],
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  },
];

export const DEFAULT_SEED_RESEARCH_FILES: ResearchFile[] = [
  {
    id: 'file-tactile-whitepaper',
    studyId: 'study-tactile-psychology',
    fileName: 'tactile_permanence_whitepaper_2024.txt',
    fileType: 'text/plain',
    fileSize: 4280,
    content: `SCIENCE OF GIFTS RESEARCH ARCHIVE\nTitle: The Psychology of Material Permanence\nAuthors: Dr. Arthur Campbell & Dr. Evelyn Vance\nAbstract: When an individual receives an object that exhibits tangible craftsmanship, deliberate weight, and honest materials (brass, oak bark leather, cast iron), their neurological response differs fundamentally from receiving an ephemeral consumer novelty. This study details the mechanics of enduring appreciation.`,
    extractedText: 'When an individual receives an object that exhibits tangible craftsmanship...',
    uploadedAt: '2026-10-01T12:00:00.000Z',
  },
];

export const DEFAULT_SEED_STYLE_PROFILES: StyleProfile[] = [
  {
    id: 'sp-sog-editorial',
    name: 'Science of Gifts Editorial',
    description: 'The signature Science of Gifts editorial voice: civilized, material-focused, understated, and unhurried.',
    isActive: true,
    hasUserEdited: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    samples: [
      {
        id: 'samp-1',
        title: 'The Case for Mechanical Objects',
        sourceDescription: 'Science of Gifts Vol. IV, Essay on Tactile Permanence',
        content: `A mechanical watch does not simply measure the passage of hours; it insists on your physical participation in that measurement. When you turn the knurled crown of a hand-wound movement between thumb and index finger, you feel the resistance of the mainspring gathering tension, thirty or forty quiet ratchets against your skin. It is an archaic ritual, completely unnecessary in an era of atomic clock synchronisation, and for precisely that reason it is irreplaceable.

The objects that outlive their owners are almost always those whose construction is decipherable by a patient observer. A machined steel case, a blued second hand, a leather strap tanned with oak bark rather than chromium salts: these things age into a patina rather than decaying into rubbish. They ask for a light coat of oil once every five years and reward that modest courtesy with half a century of unbroken rhythm.`,
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
      {
        id: 'samp-2',
        title: 'Cast Iron and the Patience of Slow Utensils',
        sourceDescription: 'Field Notes on Kitchen Craftsmanship',
        content: `A seasoned skillet possesses none of the frictionless vanity of non-stick cookware. It is heavy, stubborn, and completely indifferent to modern convenience. Drop it on a floorboard and the board will suffer, not the pan. Wash it with harsh detergent and you will spend the afternoon coaxing its carbonized sheen back to life with a rag of flaxseed oil and a hot oven.

Yet once you understand the thermal inertia of thick grey iron, lighter cookware feels flippant. The pan holds heat the way a stone hearth holds the memory of yesterday's fire. It browns butter evenly because it refuses to react impulsively to every flicker of the gas flame. To give someone a skillet of this pedigree is not to offer them a kitchen tool; it is to invite them into a slower, more deliberate domestic cadence.`,
        createdAt: '2026-10-02T14:30:00.000Z',
        updatedAt: '2026-10-02T14:30:00.000Z',
      },
    ],
    latestAnalysis: {
      id: 'analysis-seed-1',
      sampleIds: ['samp-1', 'samp-2'],
      sampleCount: 2,
      analyzedAt: '2026-10-02T15:00:00.000Z',
      summary: 'Civilized, unhurried prose anchored in tactile physical mechanics, sensory material observation, and deliberate ritual value.',
      characteristics: [
        {
          category: 'Tone',
          observation: 'Civilized, reflective, knowledgeable, and understated; avoids both academic dryness and commercial enthusiasm.',
          evidence: '"It is an archaic ritual, completely unnecessary... and for precisely that reason it is irreplaceable."',
          isCommonAcrossSamples: true,
        },
        {
          category: 'Sentence Rhythm',
          observation: 'Principally medium-length balanced compound sentences punctuated by concise declarative affirmations.',
          evidence: '"Drop it on a floorboard and the board will suffer, not the pan."',
          isCommonAcrossSamples: true,
        },
        {
          category: 'Vocabulary & Specificity',
          observation: 'Prefers exact material nouns (knurled crown, oak bark, thermal inertia, flaxseed oil) over abstract superlatives.',
          evidence: 'Specifies physical textures and technical properties instead of generic adjectives like "high quality".',
          isCommonAcrossSamples: true,
        },
        {
          category: 'Paragraph Structure',
          observation: 'Organized into two to three cohesive paragraphs, each opening with a physical action and concluding with emotional resonance.',
          isCommonAcrossSamples: true,
        },
        {
          category: 'Pacing & Openings',
          observation: 'Begins immediately with concrete sensory detail rather than rhetorical throat-clearing.',
          evidence: 'Starts with the tactile turn of a watch crown or the physical weight of an iron skillet.',
          isCommonAcrossSamples: true,
        },
        {
          category: 'Contextual Metaphors',
          observation: 'Uses organic, architectural, and historical comparisons (stone hearth, carbonized sheen) rather than digital or modern analogies.',
          isCommonAcrossSamples: false,
        },
      ],
      commonCharacteristics: [
        {
          category: 'Tone',
          observation: 'Civilized, reflective, knowledgeable, and understated without promotional urgency.',
          isCommonAcrossSamples: true,
        },
        {
          category: 'Sentence Rhythm',
          observation: 'Cadenced compound sentences mixed with sharp declarative statements for structural emphasis.',
          isCommonAcrossSamples: true,
        },
        {
          category: 'Material Specificity',
          observation: 'Rigorously specific material nouns and physical behaviors over generic adjectives.',
          isCommonAcrossSamples: true,
        },
        {
          category: 'Ritual Dimension',
          observation: 'Frames objects through their repetitive human rituals and generational permanence.',
          isCommonAcrossSamples: true,
        },
      ],
      sampleSpecificCharacteristics: [
        {
          category: 'Horological Details',
          observation: 'Mechanical movement terminology specific to the watchmaking sample.',
          isCommonAcrossSamples: false,
        },
        {
          category: 'Culinary References',
          observation: 'Thermal retention and cooking mechanics specific to the cast iron sample.',
          isCommonAcrossSamples: false,
        },
      ],
    },
    generatedInstructions: [
      'Prefer concrete physical observations and specific material nomenclature over broad generalizations.',
      'Use medium-length sentences with occasional brief, declarative sentences for rhythm.',
      'Maintain an understated, civilization-conscious tone; avoid breathless enthusiasm or marketing hyperbole.',
      'Structure paragraphs around a single tangible concept, developing the observation patiently.',
      'Ground openings immediately in physical circumstance rather than rhetorical throat-clearing.',
      'Conclude with quiet reflection on ritual utility rather than a call to action or summary.',
    ],
    userEditedInstructions: [
      'Prefer concrete physical observations and specific material nomenclature over broad generalizations.',
      'Use medium-length sentences with occasional brief, declarative sentences for rhythm.',
      'Maintain an understated, civilization-conscious tone; avoid breathless enthusiasm or marketing hyperbole.',
      'Structure paragraphs around a single tangible concept, developing the observation patiently.',
      'Ground openings immediately in physical circumstance rather than rhetorical throat-clearing.',
      'Conclude with quiet reflection on ritual utility rather than a call to action or summary.',
    ],
  },
];

export const DEFAULT_LINK_CATEGORIES: string[] = [
  'Gift Psychology',
  'Gift Advice',
  'Gift Etiquette',
  'Product & Craft Advice',
  'Design History',
  'Lifestyle & Rituals',
  'General',
];

export const DEFAULT_SEED_INTERNAL_LINKS: InternalLink[] = [
  // --- Editorial Articles ---
  {
    id: 'link-sog-displayable-gifts',
    title: 'Why People Prefer Gifts They Can Display',
    url: 'https://www.scienceofgifts.com/why-people-prefer-gifts-they-can-display/',
    topic: 'Gift psychology / displayable gifts / environmental identity',
    description: 'Explains why recipients often value gifts they can visibly incorporate into their living or working space.',
    preferredAnchor: 'why people prefer gifts they can display',
    notes: 'Useful when discussing decorative objects, table accessories, or desktop tools.',
    category: 'Gift Psychology',
    destinationType: 'article',
    active: true,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'link-sog-hand-wound-watches',
    title: 'The Tactile Permanence of Hand-Wound Watches',
    url: 'https://www.scienceofgifts.com/tactile-permanence-hand-wound-watches/',
    topic: 'Horology / mechanical tools / tactile rituals',
    description: 'Examines why turning a knurled crown and gathering mainspring tension anchors modern owners in daily ritual.',
    preferredAnchor: 'tactile permanence of mechanical watches',
    notes: 'Relevant when discussing heirloom tools, analog machinery, and daily morning rituals.',
    category: 'Product & Craft Advice',
    destinationType: 'article',
    active: true,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'link-sog-cast-iron-cookware',
    title: 'Cast Iron and the Patience of Slow Cookware',
    url: 'https://www.scienceofgifts.com/cast-iron-slow-cookware/',
    topic: 'Kitchen craft / thermal inertia / culinary heirlooms',
    description: 'The physical mechanics of seasoned cast iron, thermal retention, and domestic cooking cadence.',
    preferredAnchor: 'patience of slow cookware',
    notes: 'Ideal when discussing durable kitchen utensils, carbonized seasoning, and heirloom tools.',
    category: 'Lifestyle & Rituals',
    destinationType: 'article',
    active: true,
    createdAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 'link-sog-aging-gracefully',
    title: 'The Art of Giving Objects That Age Gracefully',
    url: 'https://www.scienceofgifts.com/giving-objects-that-age-gracefully/',
    topic: 'Material philosophy / patina / anti-disposability',
    description: 'A thesis on selecting items crafted from materials that develop patina rather than decaying into waste.',
    preferredAnchor: 'objects that age gracefully',
    notes: 'Connects with discussions on raw brass, untreated cedar, heavy denim, and longevity.',
    category: 'Gift Advice',
    destinationType: 'article',
    active: true,
    createdAt: '2026-10-02T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 'link-sog-civilized-ritual',
    title: 'Gift Giving as a Civilized Ritual',
    url: 'https://www.scienceofgifts.com/gift-giving-civilized-ritual/',
    topic: 'Social anthropology / reciprocity / gifting etiquette',
    description: 'How intentional gift exchanges strengthen lasting bonds without commercial embarrassment.',
    preferredAnchor: 'civilized ritual of gift giving',
    notes: 'Use when exploring gifting etiquette, intentionality, and avoiding panic purchases.',
    category: 'Gift Etiquette',
    destinationType: 'article',
    active: true,
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
  },
  {
    id: 'link-sog-bridle-leather',
    title: 'The Anatomy of Vegetable-Tanned Bridle Leather',
    url: 'https://www.scienceofgifts.com/anatomy-vegetable-tanned-bridle-leather/',
    topic: 'Leathercraft / oak bark tannery / durability',
    description: 'Examines why traditional vegetable tannins produce leather that outlives chromium-tanned goods.',
    preferredAnchor: 'vegetable-tanned bridle leather',
    notes: 'Essential for leather gift guides, wallets, belts, and bespoke cases.',
    category: 'Product & Craft Advice',
    destinationType: 'article',
    active: true,
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
  },

  // --- Shop Gift Guides & Collections ---
  {
    id: 'link-shop-history-gifts',
    title: 'Thoughtful Gifts for History Buffs & Teachers',
    url: 'https://shop.scienceofgifts.com/pages/history-gifts/',
    topic: 'History gifts / history teachers / historical replicas & books',
    description: 'Curated Science of Gifts shop collection featuring historical artifacts, museum-quality replicas, and scholarly desk gifts.',
    preferredAnchor: 'gift for a history teacher',
    notes: 'Commercial gift guide. Recommend when an editorial article discusses gifting for history buffs, educators, historians, or period enthusiasts.',
    category: 'Gift Advice',
    destinationType: 'shop_guide',
    active: true,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
  },
  {
    id: 'link-shop-teacher-gifts',
    title: 'Educator & Teacher Appreciation Gift Guide',
    url: 'https://shop.scienceofgifts.com/pages/teacher-gifts/',
    topic: 'Teacher gifts / educator appreciation / classroom mentors',
    description: 'Carefully chosen shop gift guide for schoolteachers, college professors, and academic mentors that avoids generic gift cards.',
    preferredAnchor: 'gifts for teachers',
    notes: 'Commercial gift guide. Recommend when articles explore teacher appreciation, mentoring, or end-of-year educator recognition.',
    category: 'Gift Advice',
    destinationType: 'shop_guide',
    active: true,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
  },
  {
    id: 'link-shop-cartography-guide',
    title: 'Cartography & Map Lovers Gift Collection',
    url: 'https://shop.scienceofgifts.com/collections/cartography-gifts',
    topic: 'Cartography gifts / map lovers / vintage navigation tools',
    description: 'Curated shop gift collection featuring letterpress elevation prints, solid brass pocket compasses, and archival cartographic instruments.',
    preferredAnchor: 'gifts for map lovers',
    notes: 'Commercial collection. Recommend when articles discuss maps, contour prints, topography, or navigation tools.',
    category: 'Product & Craft Advice',
    destinationType: 'shop_guide',
    active: true,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
  },

  // --- Individual Products ---
  {
    id: 'link-shop-viking-hoodie',
    title: 'Viking Norse Mythology Heavyweight Hoodie',
    url: 'https://shop.scienceofgifts.com/products/viking-norse-mythology-hoodie',
    topic: 'Viking apparel / Norse mythology / historical garments',
    description: 'Heavyweight 450gsm organic cotton hoodie featuring authentic historical Norse knotwork, Vegvisir runic compass, and mythological motifs.',
    preferredAnchor: 'viking norse mythology hoodie',
    notes: 'Individual product page. Recommend when the article specifically mentions Viking apparel, Norse mythology gifts, or historical rune wear.',
    category: 'Lifestyle & Rituals',
    destinationType: 'product',
    active: true,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: '2026-10-05T12:00:00.000Z',
  },
  {
    id: 'link-shop-teacher-mug',
    title: 'History Teacher Definition Ceramic Mug',
    url: 'https://shop.scienceofgifts.com/products/history-teacher-definition-mug',
    topic: 'Teacher gifts / ceramic drinkware / history teacher identity',
    description: 'High-fire 15oz ceramic mug printed with an authentic, witty historical educator definition and archival typography.',
    preferredAnchor: 'history teacher definition mug',
    notes: 'Individual product page. Recommend when prose specifically discusses identity mugs, history teacher desk accessories, or teacher drinkware.',
    category: 'Lifestyle & Rituals',
    destinationType: 'product',
    active: true,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: '2026-10-05T12:00:00.000Z',
  },
  {
    id: 'link-shop-dalvey-compass',
    title: 'Dalvey Voyager Brass Pocket Compass',
    url: 'https://shop.scienceofgifts.com/products/dalvey-voyager-compass',
    topic: 'Navigational instrument / Scottish brass / pocket compass',
    description: 'Machined Scottish mirror-polished brass pocket instrument with liquid-damped jewel capsule and spring-loaded lid.',
    preferredAnchor: 'Dalvey brass pocket compass',
    notes: 'Individual product page. Connect with discussions of manual navigation, tactile pocket instruments, and heirloom brass tools.',
    category: 'Product & Craft Advice',
    destinationType: 'product',
    active: true,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: '2026-10-05T12:00:00.000Z',
  },
  {
    id: 'link-shop-topographic-print',
    title: 'Letterpress Topographic Ridge Elevation Print',
    url: 'https://shop.scienceofgifts.com/products/topographic-letterpress-print',
    topic: 'Wall art / relief print / contour topography',
    description: 'Deep-debossed relief contour print on 600gsm Somerset heavy cotton rag paper, hand-pulled on a vintage cylinder press.',
    preferredAnchor: 'letterpress topographic ridge print',
    notes: 'Individual product page. Link when articles discuss tactile wall prints, physical contour lines, or tactile map art.',
    category: 'Product & Craft Advice',
    destinationType: 'product',
    active: true,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: '2026-10-05T12:00:00.000Z',
  },
  {
    id: 'link-shop-desk-magnifier',
    title: 'Solid Brass 3-Inch Desk Magnifier & Paperweight',
    url: 'https://shop.scienceofgifts.com/products/brass-desk-magnifier',
    topic: 'Desk tools / optical magnifier / turned brass',
    description: 'Ground 4x crown-glass optical lens encased in a heavy turned unlacquered brass ring with beveled glide rim.',
    preferredAnchor: 'solid brass desk magnifier',
    notes: 'Individual product page. Suitable for articles discussing map inspection loupes, antiquarian reading tools, or weighted desk objects.',
    category: 'Product & Craft Advice',
    destinationType: 'product',
    active: true,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: '2026-10-05T12:00:00.000Z',
  },
];
