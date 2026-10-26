import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildReportUrl } from '../pipeline/report-export';
import { ReportGenerator } from '../lib/reports/reports';

test('report URL includes site origin and the post pillar route', () => {
  assert.equal(
    buildReportUrl('saxon-switzerland-travel-guide', { pillar: 'travel-in-germany' }, 'letsgogermany.com'),
    'https://letsgogermany.com/travel-in-germany/saxon-switzerland-travel-guide',
  );
});

test('JSON reports are generated without Python and retain the SeoFlow score', () => {
  const tempRoot = process.env.TMPDIR || tmpdir();
  const outputDir = mkdtempSync(path.join(tempRoot, 'seoflow-report-test-'));
  const outputPath = path.join(outputDir, 'report.json');
  try {
    ReportGenerator.generate({ url: 'https://letsgogermany.com/travel-in-germany/example', score: 73, issues: [], warnings: [], quickWins: [] }, {
      format: 'json', outputDir, filename: 'report.json',
    });
    const report = JSON.parse(readFileSync(outputPath, 'utf8'));
    assert.equal(report.data.url, 'https://letsgogermany.com/travel-in-germany/example');
    assert.equal(report.data.score, 73);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
