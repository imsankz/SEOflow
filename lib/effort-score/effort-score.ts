/**
 * 2026 Google Content Effort & Anti-SAFE Analyzer
 *
 * Implements heuristics aligned with:
 * - Leaked Google API ranking metrics (`contentEffort`, `ugcDiscussionEffortScore`)
 * - Quality Rater Guidelines "Effort" standard (referenced ~100x)
 * - October 1, 2026 Helpful Content Update (crackdown on fake authors and scaled filler)
 * - Google's SAFE (Scaled Abuse Forensics Examiner) spam detector
 */

export interface EffortScoreBreakdown {
  firsthandScore: number;       // max 25
  visualProofScore: number;     // max 25
  originalDataScore: number;    // max 25
  authorshipScore: number;      // max 15
  antiSafeIntroScore: number;   // max 10
  totalScore: number;           // max 100
  rating: 'EXEMPLARY' | 'GOOD' | 'MARGINAL' | 'HIGH_RISK';
  diagnostics: string[];
  recommendations: string[];
}

export class EffortScoreAnalyzer {
  static analyze(content: string, frontmatter: Record<string, any> = {}): EffortScoreBreakdown {
    const diagnostics: string[] = [];
    const recommendations: string[] = [];

    // 1. Firsthand Experience (Max 25)
    let firsthandScore = 0;
    const pronounRegex = /\b(i visited|when i visited|in my experience|when i tested|i tested|we tested|when i went|i spent|we spent|during my visit|during our visit|my experience|i noticed|we noticed|i found|we found|i recommend|i bought|we bought|i paid|we paid|i took|we took|in our experience|during my stay|during our stay|we stayed|i stayed|when i walked|we walked|when i was in|my trip|our trip|i personally|firsthand|on the ground|my honest (?:verdict|take|opinion|impression))\b/gi;
    const pronounMatches = (content.match(pronounRegex) || []).map(m => m.toLowerCase());
    const uniquePronouns = new Set(pronounMatches);

    if (uniquePronouns.size >= 4) firsthandScore += 12;
    else if (uniquePronouns.size >= 2) firsthandScore += 8;
    else if (uniquePronouns.size >= 1) firsthandScore += 4;
    else {
      recommendations.push('Add authentic firsthand narrative cues ("when I visited", "when I tested", "I bought").');
    }

    if (frontmatter.visitedDate) {
      firsthandScore += 6;
      diagnostics.push(`Frontmatter visitedDate detected: ${frontmatter.visitedDate}`);
    } else if (/\b(?:visited in|traveled in|stayed in)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i.test(content)) {
      firsthandScore += 4;
    } else {
      recommendations.push('Include explicit on-the-ground visit date (e.g., frontmatter `visitedDate: YYYY-MM-DD`).');
    }

    if (frontmatter.lastVerified) {
      firsthandScore += 7;
      diagnostics.push(`Freshness verification verified: ${frontmatter.lastVerified}`);
    } else {
      recommendations.push('Add `lastVerified: YYYY-MM-DD` in frontmatter to signal active fact-checking.');
    }
    firsthandScore = Math.min(25, firsthandScore);

    // 2. Visual Proof & Media Effort (Max 25)
    let visualProofScore = 0;
    const markdownImages = (content.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []);
    const jsxImages = (content.match(/<(?:img|TravelImage|Image)\b[^>]*>/gi) || []);
    const totalImages = markdownImages.length + jsxImages.length;

    if (totalImages >= 5) visualProofScore += 10;
    else if (totalImages >= 2) visualProofScore += 7;
    else if (totalImages >= 1) visualProofScore += 4;
    else recommendations.push('Embed original in-body photos or UI captures; currently lacks visual proof.');

    // Check for interactive/proof components
    let componentScore = 0;
    if (/<VerifiedData\b/i.test(content)) componentScore += 4;
    if (/<PersonalVerdict\b/i.test(content)) componentScore += 3;
    if (/<CalculatorCTA\b/i.test(content)) componentScore += 2;
    if (/<(?:FAQ|Accordion)\b/i.test(content)) componentScore += 2;
    visualProofScore += Math.min(10, componentScore);

    // Image alt text / captions quality
    let descriptiveAltCount = 0;
    for (const img of markdownImages) {
      const altMatch = img.match(/!\[([^\]]*)\]/);
      if (altMatch && altMatch[1].trim().length > 10) descriptiveAltCount++;
    }
    if (descriptiveAltCount >= 2) visualProofScore += 5;
    else if (totalImages > 0) visualProofScore += 2;
    visualProofScore = Math.min(25, visualProofScore);

    // 3. Original Data & Math (Max 25)
    let originalDataScore = 0;
    const hasTable = /\|[\s-:]+\|/.test(content) || /<table\b/i.test(content) || /<VerifiedData\b/i.test(content);
    if (hasTable) {
      originalDataScore += 8;
    } else {
      recommendations.push('Add a structured comparison table showing gate prices vs pass totals.');
    }

    const priceMatches = content.match(/(?:€|\$|£)\s*\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s*(?:EUR|USD|GBP|euros?|dollars?|CZK|HUF|PLN|SEK|NOK|CHF)\b/gi) || [];
    if (priceMatches.length >= 20) originalDataScore += 8;
    else if (priceMatches.length >= 8) originalDataScore += 6;
    else if (priceMatches.length >= 3) originalDataScore += 3;
    else recommendations.push('Increase specific pricing data points (entry fees, tickets, public transit fares).');

    // Delta savings math
    const hasDeltaMath = /(?:delta|difference of|saving of|saves? about|net saving|saved €|break-even)\s*(?:€|\$|£)?\s*\d+/i.test(content) ||
      /<VerifiedData[^>]*delta/i.test(content);
    if (hasDeltaMath) {
      originalDataScore += 9;
    } else if (/(?:saving|cheaper|expensive|worth it|cost vs)/i.test(content)) {
      originalDataScore += 4;
      recommendations.push('Provide exact mathematical delta calculations (e.g. "saves €9.90 compared to individual gate tickets").');
    }
    originalDataScore = Math.min(25, originalDataScore);

    // 4. Authorship & Identity Verifiability (Max 15)
    let authorshipScore = 0;
    const author = frontmatter.author || '';
    if (author && author.trim().length > 3) {
      authorshipScore += 8;
      diagnostics.push(`Author identified: ${author}`);
      if (frontmatter.authorBio || /about the author/i.test(content) || frontmatter.socials) {
        authorshipScore += 7;
      } else {
        authorshipScore += 4; // default author present
      }
    } else {
      recommendations.push('Assign a verified, transparent author byline in frontmatter.');
    }
    authorshipScore = Math.min(15, authorshipScore);

    // 5. Anti-SAFE & Intro Directness (Max 10)
    let antiSafeIntroScore = 0;
    const introSnippet = content.slice(0, 800);
    const hasFastVerdict = /<AIQuickSummary\b/i.test(introSnippet) ||
      /\*\*(?:verdict|quick answer|bottom line|is it worth it\?)\*\*[:\s]+[^\n]+/i.test(introSnippet);

    if (hasFastVerdict) {
      antiSafeIntroScore += 10;
    } else if (/\b(?:worth it|recommend|verdict)\b/i.test(introSnippet)) {
      antiSafeIntroScore += 5;
      recommendations.push('Move primary verdict or `<AIQuickSummary>` above the fold in the first 100 words.');
    }

    // Check for SAFE generic filler patterns
    const fillerPatterns = [
      /(?:are you|so you are|if you are)\s+planning\s+(?:a\s+trip|to\s+visit)/i,
      /welcome to (?:our|the) (?:ultimate|complete) guide/i,
      /let us dive in/i,
      /nestled in the heart of/i
    ];
    let detectedFillers = 0;
    for (const pattern of fillerPatterns) {
      if (pattern.test(introSnippet)) detectedFillers++;
    }
    if (detectedFillers > 0) {
      antiSafeIntroScore = Math.max(0, antiSafeIntroScore - (detectedFillers * 3));
      recommendations.push('Remove generic introductory filler phrases to avoid SAFE spam classification.');
    }

    const totalScore = firsthandScore + visualProofScore + originalDataScore + authorshipScore + antiSafeIntroScore;

    let rating: EffortScoreBreakdown['rating'] = 'HIGH_RISK';
    if (totalScore >= 80) rating = 'EXEMPLARY';
    else if (totalScore >= 65) rating = 'GOOD';
    else if (totalScore >= 50) rating = 'MARGINAL';

    return {
      firsthandScore,
      visualProofScore,
      originalDataScore,
      authorshipScore,
      antiSafeIntroScore,
      totalScore,
      rating,
      diagnostics,
      recommendations
    };
  }
}
