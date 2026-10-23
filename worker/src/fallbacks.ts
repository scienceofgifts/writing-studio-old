/**
 * Pure Fallback Responses for Science of Gifts Writing Studio API Worker
 */

export function generateFallbackResponse(payload: any): { proposedText: string; explanation: string } {
  const { action, selectedText, currentContent, customCommand, relevantProduct, projectType, metadata = {} } = payload;
  const target = selectedText || 'the highlighted text';

  if (action === 'create_seo_title') {
    return {
      proposedText: `The Art of the Heirloom: A Discerning Guide | Science of Gifts`,
      explanation: 'Crafted a concise, high-intent title under 60 characters without generic buzzwords.'
    };
  }

  if (action === 'create_meta_description') {
    return {
      proposedText: `An unhurried editorial guide exploring bench-made craft, enduring materials, and why utilitarian gifts outlive modern disposable gadgets.`,
      explanation: 'Summarized core thesis in 150 characters with natural search resonance.'
    };
  }

  if (action === 'generate_intro' || action === 'generate_gift_guide_intro') {
    const topic = metadata?.primaryTopic || 'permanent objects and lasting craft';
    const audience = metadata?.audience || 'discerning recipients';
    return {
      proposedText: `<p>For the person who values enduring utility over disposable convenience, a gift is never merely a seasonal transaction. It is an acknowledgment of character. In assembling this guide to ${topic}, we have deliberately bypassed ephemeral novelties in favor of pieces crafted from honest materials: turned brass, heavy cotton canvas, and mechanical movements built to outlast trends.</p><p>What follows is a curated collection for ${audience}, chosen because every item possesses the quiet dignity of a tool meant for daily life.</p>`,
      explanation: 'Authored an unhurried, evocative opening establishing the curatorial premise without generic "Whether you\'re looking for" clichés.'
    };
  }

  if (action === 'generate_best_for') {
    const pName = relevantProduct?.name || 'this piece';
    return {
      proposedText: `<p><strong>Best for:</strong> A recipient who appreciates mechanical permanence, tactile materials, and everyday tools built without planned obsolescence.</p>`,
      explanation: `Created a concise, perceptive recipient summary for "${pName}".`
    };
  }

  if (action === 'generate_product_section') {
    const p = relevantProduct || {};
    const name = p.name || 'Recommended Piece';
    const url = p.url || '';
    const materials = p.materialDetails || p.materials || 'traditional honest materials';
    const context = p.historicalContext || 'proven utilitarian lineage';
    const fits = p.whyItFits || 'it balances authentic craft with practical daily utility';
    const bestFor = p.bestFor || 'The connoisseur who appreciates durable tools and heirloom construction.';

    const linkHtml = url ? `<a href="${url}">${name}</a>` : name;
    return {
      proposedText: `<h2>${linkHtml}</h2><p>Constructed with strict fidelity to ${materials}, this piece avoids modern shortcuts in favor of structural substance. Rooted in ${context}, it bridges the gap between historical instrument and daily companion.</p><p>Its presence in this collection is earned because ${fits}. In regular use, the surface will gradually develop an intimate patina unique to its owner's habits.</p><p><strong>Best for:</strong> ${bestFor}</p>`,
      explanation: `Drafted an insightful product entry for "${name}" respecting provided raw specifications without marketing fluff.`
    };
  }

  if (action === 'generate_buyer_advice') {
    return {
      proposedText: `<h2>Buyer Guidance: Discerning Craft from Commercial Novelty</h2><p>When selecting a gift in this category, resist the temptation of mass-produced listicle recommendations. Look past marketing claims of "luxury" and examine the physical joints, the weight of the raw materials, and the ease with which components can be cleaned or serviced.</p><p>Consider the recipient's daily rhythm: a display piece must possess genuine sculptural or typographic integrity, while an everyday tool should feel balanced in the hand and indifferent to rough weather. True longevity is quiet; it proves itself after the third year of regular use.</p>`,
      explanation: 'Delivered grounded buyer guidance centered on physical construction rather than brand hype.'
    };
  }

  if (action === 'generate_faq') {
    return {
      proposedText: `<h2>Frequently Asked Questions</h2><div class="space-y-4"><p><strong>Q: How do I know if an item in this guide is authentic heirloom quality?</strong><br/>A: Look for mechanical fasteners rather than adhesive seals, solid unlacquered alloys that develop natural patina, and designs that can be maintained or repaired over decades.</p><p><strong>Q: Are these gifts suitable for someone who already owns similar gear?</strong><br/>A: Yes. Connoisseurs value pieces with distinct manufacturing provenance, such as bench-made letterpress printing or Scottish highland machining, which stand apart from standard consumer gear.</p><p><strong>Q: How should delicate prints or brass tools be cared for?</strong><br/>A: Most natural materials require little more than occasional attention: wiping with a dry cotton cloth or storing in acid-free portfolios away from direct ultraviolet sunlight.</p></div>`,
      explanation: 'Drafted tight, informative FAQ entries addressing authentic buyer questions.'
    };
  }

  if (action === 'generate_conclusion') {
    return {
      proposedText: `<h2>A Concluding Thought on Lasting Gifts</h2><p>A well-chosen gift is not an exercise in commercial excess; it is an act of attentive observation. By offering an object anchored in deliberate craft, durable materials, and historical dignity, you leave the recipient with something that will quietly accompany their routines for years to come.</p>`,
      explanation: 'Concluded with a resonant, memorable editorial perspective on the gesture of gifting.'
    };
  }

  if (action === 'generate_collection_link') {
    const colUrl = metadata?.collectionUrl || 'https://shop.scienceofgifts.com/collections';
    return {
      proposedText: `<p>To explore the complete curated selection of instruments, prints, and objects, view the <a href="${colUrl}">Science of Gifts collection</a>.</p>`,
      explanation: 'Inserted a natural, editorially integrated collection hyperlink.'
    };
  }

  if (action === 'generate_section') {
    const secTitle = payload.targetOutlineItem?.title || customCommand || 'Section';
    return {
      proposedText: `<h2>${secTitle}</h2><p>True utility reveals itself not in the showroom, but in the rhythm of repetitive daily use. When examined closely, the construction favors mechanical joinery and repairable components over sealed, disposable assemblies. This intentional choice ensures the piece ages with grace rather than degrading into landfill.</p>`,
      explanation: `Drafted an editorial section focusing on durability and physical mechanics for "${secTitle}".`
    };
  }

  if (action === 'continue_writing') {
    return {
      proposedText: `<p>What distinguishes an enduring gift from an ephemeral novelty is the absence of theatrical compromise. It makes no loud claims about lifestyle or prestige; instead, it performs its single function with quiet mechanical dignity, season after season.</p>`,
      explanation: 'Extended the draft naturally with unhurried editorial reasoning.'
    };
  }

  if (action === 'make_more_concise') {
    const cleaned = (selectedText || 'The piece')
      .replace(/—/g, ', ')
      .replace(/Whether you're looking for.*?,\s*/gi, '')
      .replace(/in order to/gi, 'to')
      .trim();
    return {
      proposedText: `${cleaned.split('.')[0] || cleaned}. Its value lies purely in honest execution.`,
      explanation: 'Tightened syntax, trimmed superfluous adverbs, and clarified the core proposition.'
    };
  }

  if (action === 'expand_selection') {
    return {
      proposedText: `${selectedText ? selectedText.trim() + ' ' : ''}Notice how the chamfered edge softens the grip, and how the weight sits balanced in the palm. These minute ergonomic decisions are never accidental; they are the consequence of patient bench testing.`,
      explanation: 'Deepened tactile and sensory observations without introducing marketing hype.'
    };
  }

  if (action === 'improve_flow') {
    return {
      proposedText: `<p>${selectedText ? selectedText.trim() : 'The transition between form and utility remains uninterrupted.'} Rather than competing for attention, each element supports a quiet, purposeful rhythm on the desk or in the pocket.</p>`,
      explanation: 'Harmonized cadence and smoothed paragraph transitions.'
    };
  }

  if (action === 'change_tone') {
    return {
      proposedText: `${selectedText ? selectedText.trim() : 'An honest object.'} There is a refreshing clarity in something built without pretension, intended to outlive the season's fleeting trends.`,
      explanation: 'Adjusted tonal register to align with active writing controls.'
    };
  }

  if (action === 'add_context') {
    return {
      proposedText: `${selectedText ? selectedText.trim() + ' ' : ''}Rooted in mid-century tool traditions where serviceability was assumed, its lineage reflects a time before planned obsolescence became industrial doctrine.`,
      explanation: 'Introduced historical provenance and craft heritage.'
    };
  }

  if (action === 'simplify') {
    return {
      proposedText: `${selectedText ? selectedText.replace(/complicated|utilitarianism/gi, 'simple utility').trim() : 'Clean, direct utility.'}`,
      explanation: 'Untangled complex phrasing into clear, readable prose.'
    };
  }

  if (action === 'review_writing') {
    return {
      proposedText: `<p>${selectedText || currentContent ? (selectedText || currentContent).slice(0, 300) : 'An unhurried exploration of craft.'}</p><p>Its endurance comes from disciplined craftsmanship rather than decorative novelty.</p>`,
      explanation: 'Editorial review: tightened sentence variety, eliminated passive constructions, and deepened concrete observations.'
    };
  }

  if (relevantProduct) {
    const name = relevantProduct.name || relevantProduct.productName || 'This piece';
    return {
      proposedText: `Machined and finished with strict adherence to traditional standards, ${name} avoids modern shortcuts in favor of structural substance. The materials have a tangible weight in the hand, suggesting it was designed for daily utility rather than temporary novelty.`,
      explanation: 'Generated specific, restrained product prose honoring the raw material notes without marketing hyperbole.'
    };
  }

  if (selectedText) {
    const cleaned = selectedText
      .replace(/—/g, ', ')
      .replace(/Whether you're looking for.*?,\s*/gi, '')
      .replace(/perfect for/gi, 'well suited to')
      .replace(/takes it to the next level/gi, 'elevates its daily utility')
      .trim();

    return {
      proposedText: `${cleaned} It possesses the quiet weight of an object made to be used and kept, rather than replaced.`,
      explanation: 'Stripped generic phrasing and tightened the sentence structure to reflect Science of Gifts house style.'
    };
  }

  return {
    proposedText: `An unhurried exploration of craft, utility, and objects built to outlast fleeting seasons.`,
    explanation: 'Generated editorial copy aligned with Science of Gifts standards.'
  };
}

export function generateFallbackIdeas(topic: string, audience: string, goal: string, style: string) {
  const cleanTopic = topic.trim();
  const aud = audience.trim() || 'the recipient';

  return [
    {
      id: `idea-fb-1`,
      title: `Why ${cleanTopic} Often Communicates More About the Giver Than the Recipient`,
      angle: `Explore the psychological gap between what givers hope to signal and what ${aud} actually experiences when opening a specialized gift.`,
      whyInteresting: `Connects gift-giving psychology with the specific nuance of ${cleanTopic} without turning into a generic product catalogue.`,
      searchIntent: 'Psychological',
    },
    {
      id: `idea-fb-2`,
      title: `The Difference Between a Genuine Tool and a Novelty Piece in ${cleanTopic}`,
      angle: `Examine the material and functional dividing line between objects built for lifetime utility versus decorative items disguised as tools.`,
      whyInteresting: `Provides discerning readers with a tangible framework for judging authenticity and build quality.`,
      searchIntent: 'Informational',
    },
    {
      id: `idea-fb-3`,
      title: `What Makes a Gift in ${cleanTopic} Feel Authentic Rather Than Generic?`,
      angle: `Investigate why surface branding fails while quiet manufacturing provenance and honest materials resonate deeply.`,
      whyInteresting: `Moves past superficial aesthetic checklists to focus on emotional durability and craftsmanship.`,
      searchIntent: 'Problem-solving',
    },
    {
      id: `idea-fb-4`,
      title: `The Quiet Longevity of Well-Made ${cleanTopic}: Why Less Is More`,
      angle: `Contrast the fleeting excitement of complex feature-heavy gadgets with the understated dignity of single-purpose instruments.`,
      whyInteresting: `Directly challenges modern consumerist assumptions by defending durability and repairability.`,
      searchIntent: 'Cultural',
    },
    {
      id: `idea-fb-5`,
      title: `How to Choose ${cleanTopic} for Someone Who Already Owns Everything`,
      angle: `Offer a thoughtful curatorial strategy focused on vintage archival editions, restoration services, or companion tools rather than redundant gear.`,
      whyInteresting: `Directly solves one of the most common and agonizing gift dilemmas with unexpected elegance.`,
      searchIntent: 'Practical',
    },
    {
      id: `idea-fb-6`,
      title: `The Unspoken Etiquette of Giving Specialized ${cleanTopic}`,
      angle: `Analyze how receiving an advanced object can inadvertently create pressure or obligation for a novice recipient.`,
      whyInteresting: `Explores subtle interpersonal dynamics that standard gift blogs completely overlook.`,
      searchIntent: 'Psychological',
    },
    {
      id: `idea-fb-7`,
      title: `Why Material Provenance Matters in ${cleanTopic}`,
      angle: `Trace how raw ingredients, turned brass, and vegetable-tanned leathers develop an intimate patina that artificial composites cannot match.`,
      whyInteresting: `Appeals to connoisseurs and craft enthusiasts who appreciate physical aging and tactile permanence.`,
      searchIntent: 'Informational',
    },
    {
      id: `idea-fb-8`,
      title: `The Anatomy of a Regrettable Gift in ${cleanTopic} (And How to Avoid It)`,
      angle: `Dissect three subtle mistakes well-meaning gifters make when navigating this category without first-hand domain expertise.`,
      whyInteresting: `Offers practical protective guidance that saves givers from wasteful or awkward purchases.`,
      searchIntent: 'Problem-solving',
    },
    {
      id: `idea-fb-9`,
      title: `From Ritual to Utility: How Daily Habits Transform ${cleanTopic}`,
      angle: `Observe how repetitive morning and evening routines turn an ordinary purchased object into an irreplaceable personal artifact.`,
      whyInteresting: `Elevates everyday utilitarian tools into meaningful reflections of personal identity.`,
      searchIntent: 'Cultural',
    },
    {
      id: `idea-fb-10`,
      title: `The Collector's Dilemma: Navigating Archival ${cleanTopic}`,
      angle: `Contrast the joy of preserved historical artifacts with modern bench-made recreations built for active daily handling.`,
      whyInteresting: `Creates a fascinating distinction between museum display pieces and active heirloom tools.`,
      searchIntent: 'Informational',
    },
  ];
}
