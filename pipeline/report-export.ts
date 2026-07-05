import { StepInput, StepOutput } from '../lib/types';
import { ReportGenerator } from '../lib/reports/reports';
import { countWords, countInternalLinks, countImages } from '../lib/mdx-parser';

export interface ReportExportConfig {
  format?: 'pdf' | 'html' | 'json';
  outputDir?: string;
  filename?: string;
  includeTechnical?: boolean;
  includeContent?: boolean;
  includeSchema?: boolean;
  includeBacklinks?: boolean;
}

function computeScore(input: StepInput): number {
  const fm = input.frontmatter;
  const body = input.content;

  // Title quality
  const titleScore = fm.title && fm.title.length >= 30 && fm.title.length <= 60 ? 90 : fm.title ? 60 : 0;

  // Description quality
  const descScore = fm.description && fm.description.length >= 120 && fm.description.length <= 160 ? 90 : fm.description ? 60 : 0;

  // Word count (target: 1500+)
  const wordCount = countWords(body);
  const wordScore = wordCount >= 2000 ? 100 : wordCount >= 1500 ? 80 : wordCount >= 1000 ? 60 : wordCount >= 500 ? 40 : 20;

  // Internal links (target: 3+)
  const linkCount = countInternalLinks(body);
  const linkScore = linkCount >= 5 ? 100 : linkCount >= 3 ? 80 : linkCount >= 1 ? 60 : 30;

  // Images (target: 2+)
  const imageCount = countImages(body);
  const imageScore = imageCount >= 4 ? 100 : imageCount >= 2 ? 80 : imageCount >= 1 ? 60 : 30;

  // Schema
  const schemaScore = fm.schema ? 80 : 0;

  // Deductions from frontmatter flags
  const issues = Array.isArray(fm.issues) ? fm.issues : [];
  const warnings = Array.isArray(fm.warnings) ? fm.warnings : [];
  const deduction = issues.length * 5 + warnings.length * 2;

  const raw = (titleScore + descScore + wordScore + linkScore + imageScore + schemaScore) / 6;
  return Math.max(0, Math.min(100, Math.round(raw - deduction)));
}

export function stepExportReport(input: StepInput, options: ReportExportConfig = {}): StepOutput {
  const {
    format = 'pdf',
    outputDir = 'reports',
    filename = `report-${input.slug}-${Date.now()}.${format}`,
    includeTechnical = true,
    includeContent = true,
    includeSchema = true,
    includeBacklinks = false,
  } = options;

  const changes: string[] = [];

  try {
    const score = computeScore(input);
    const issues = Array.isArray(input.frontmatter.issues) ? input.frontmatter.issues : [];
    const warnings = Array.isArray(input.frontmatter.warnings) ? input.frontmatter.warnings : [];
    const quickWins = Array.isArray(input.frontmatter.quickWins) ? input.frontmatter.quickWins : [];

    const reportData = {
      url: input.slug,
      score,
      issues,
      warnings,
      quickWins,
      wordCount: countWords(input.content),
      internalLinks: countInternalLinks(input.content),
      images: countImages(input.content),
    };

    const outputPath = ReportGenerator.generate(reportData, {
      format,
      outputDir,
      filename,
      includeTechnical,
      includeContent,
      includeSchema,
      includeBacklinks,
    });

    changes.push(`Generated ${format.toUpperCase()} report: ${outputPath} (score: ${score}/100)`);
  } catch (error) {
    console.error(`Failed to generate report: ${error}`);
    changes.push(`⚠️  Failed to generate report: ${error}`);
  }

  return {
    ...input,
    changes,
  };
}
