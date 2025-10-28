const express = require('express');
const cors = require('cors');
const fuzz = require('fuzzball');

const app = express();
app.use(cors());
app.use(express.json());

// Normalize color strings for matching
function normalizeColor(color) {
  if (!color) return '';
  return color
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove spaces, dashes, etc.
    .trim();
}

// Main matching endpoint
app.post('/match-color', (req, res) => {
  const { ourColor, theirColors, threshold = 80 } = req.body;

  if (!ourColor || !theirColors || !Array.isArray(theirColors)) {
    return res.status(400).json({
      error: 'Missing required fields: ourColor (string) and theirColors (array)'
    });
  }

  // Normalize our color
  const ourNormalized = normalizeColor(ourColor);

  // If exact match exists (after normalization), return it immediately
  const exactMatch = theirColors.find(
    color => normalizeColor(color) === ourNormalized
  );

  if (exactMatch) {
    return res.json({
      matched: true,
      matchedColor: exactMatch,
      confidence: 100,
      method: 'exact',
      needsReview: false
    });
  }

  // No exact match - do fuzzy matching
  // Normalize their colors for matching
  const colorChoices = theirColors.map(color => ({
    original: color,
    normalized: normalizeColor(color)
  }));

  // Find best matches using fuzzball
  const results = fuzz.extract(
    ourNormalized,
    colorChoices.map(c => c.normalized),
    {
      scorer: fuzz.token_sort_ratio,
      limit: 3,
      cutoff: 50
    }
  );

  if (!results || results.length === 0) {
    return res.json({
      matched: false,
      matchedColor: null,
      confidence: 0,
      method: 'fuzzy',
      needsReview: true,
      alternatives: []
    });
  }

  // Get the best match
  const bestMatch = results[0];
  const bestColor = colorChoices[bestMatch[2]].original;
  const confidence = bestMatch[1];

  console.log(`Matching "${ourColor}" -> "${bestColor}" (${confidence}% confidence)`);

  // Get top 3 alternatives
  const alternatives = results.map(r => ({
    color: colorChoices[r[2]].original,
    confidence: r[1]
  }));

  return res.json({
    matched: confidence >= threshold,
    matchedColor: confidence >= threshold ? bestColor : null,
    confidence: confidence,
    method: 'fuzzy',
    needsReview: confidence < 90,
    alternatives: alternatives
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'sanmar-color-matcher' });
});

// Test endpoint
app.post('/test', (req, res) => {
  const testCases = [
    { our: 'HeatheredRoyalGray', their: ['Heather Royal Gray', 'Royal Blue', 'Heathered Royal Gry'] },
    { our: 'NavyBlazer', their: ['Navy Blazer', 'Navy Blue', 'Black'] },
    { our: 'TNFBlack', their: ['TNF Black', 'The North Face Black', 'Black'] },
    { our: 'JetBlack', their: ['Jet Black', 'Black', 'True Black'] }
  ];

  const results = testCases.map(test => {
    const ourNormalized = normalizeColor(test.our);
    const colorChoices = test.their.map(c => ({ 
      original: c, 
      normalized: normalizeColor(c) 
    }));
    
    const matches = fuzz.extract(
      ourNormalized,
      colorChoices.map(c => c.normalized),
      {
        scorer: fuzz.token_sort_ratio,
        limit: 1
      }
    );
    
    const best = matches[0];
    
    return {
      input: test.our,
      options: test.their,
      matched: colorChoices[best[2]].original,
      confidence: best[1]
    };
  });

  res.json({ testResults: results });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Color matching service running on port ${PORT}`);
  console.log(`Test it: curl http://localhost:${PORT}/health`);
});