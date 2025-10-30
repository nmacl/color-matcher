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

// Helper to create consonant-only version (for abbreviation matching)
function getConsonants(str) {
  return str.replace(/[aeiou]/gi, '').toLowerCase();
}

// Main matching endpoint
app.post('/match-color', (req, res) => {
  const { ourColor, theirColors, threshold = 74 } = req.body;

  if (!ourColor || !theirColors || !Array.isArray(theirColors)) {
    return res.status(400).json({
      error: 'Missing required fields: ourColor (string) and theirColors (array)'
    });
  }

  // Normalize our color
  const ourNormalized = normalizeColor(ourColor);

  // STRATEGY 1: Exact match (after normalization)
  const exactMatch = theirColors.find(
    color => normalizeColor(color) === ourNormalized
  );

  if (exactMatch) {
    console.log(`Exact match: "${ourColor}" -> "${exactMatch}"`);
    return res.json({
      matched: true,
      matchedColor: exactMatch,
      confidence: 100,
      method: 'exact',
      needsReview: false
    });
  }

  // STRATEGY 2: Standard fuzzy match
  const colorChoices = theirColors.map(color => ({
    original: color,
    normalized: normalizeColor(color)
  }));

  const fuzzyResults = fuzz.extract(
    ourNormalized,
    colorChoices.map(c => c.normalized),
    {
      scorer: fuzz.token_sort_ratio,
      limit: 3,
      cutoff: 50
    }
  );

  if (!fuzzyResults || fuzzyResults.length === 0) {
    console.log(`No matches found for "${ourColor}"`);
    return res.json({
      matched: false,
      matchedColor: null,
      confidence: 0,
      method: 'none',
      needsReview: true,
      alternatives: []
    });
  }

  let bestMatch = fuzzyResults[0];
  let bestColor = colorChoices[bestMatch[2]].original;
  let confidence = bestMatch[1];
  let method = 'fuzzy';

  console.log(`Fuzzy match: "${ourColor}" -> "${bestColor}" (${confidence}%)`);

  // STRATEGY 3: If confidence too low, try consonant matching (for abbreviations)
  if (confidence < 75) {
    console.log(`Low confidence (${confidence}%), trying consonant matching...`);
    
    const ourConsonants = getConsonants(ourNormalized);
    const consonantChoices = colorChoices.map(c => ({
      original: c.original,
      consonants: getConsonants(c.normalized)
    }));

    console.log(`  Our consonants: "${ourConsonants}"`);
    console.log(`  Their consonants: ${JSON.stringify(consonantChoices.map(c => c.consonants))}`);

    const consonantResults = fuzz.extract(
      ourConsonants,
      consonantChoices.map(c => c.consonants),
      {
        scorer: fuzz.ratio, // Simple Levenshtein distance works well for consonants
        limit: 3,
        cutoff: 50
      }
    );

    const consonantBest = consonantResults[0];
    const consonantConfidence = consonantBest[1];

    console.log(`  Consonant best match: "${consonantChoices[consonantBest[2]].original}" (${consonantConfidence}%)`);

    // If consonant matching is significantly better, use it
    if (consonantConfidence > confidence + 10) { // +10 buffer to prefer consonant
      bestMatch = consonantBest;
      bestColor = consonantChoices[consonantBest[2]].original;
      confidence = consonantConfidence;
      method = 'consonant';
      
      console.log(`  → Using consonant match: "${bestColor}" (${confidence}%)`);
    }
  }

  console.log(`Final result: "${ourColor}" -> "${bestColor}" (${confidence}% via ${method})`);

  // Get top 3 alternatives from fuzzy results
  const alternatives = fuzzyResults.slice(0, 3).map(r => ({
    color: colorChoices[r[2]].original,
    confidence: r[1]
  }));

  return res.json({
    matched: confidence >= threshold,
    matchedColor: confidence >= threshold ? bestColor : null,
    confidence: Math.round(confidence),
    method: method,
    needsReview: confidence < 90,
    alternatives: alternatives
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'color-matcher' });
});

// Test endpoint
app.post('/test', (req, res) => {
  const testCases = [
    { our: 'HeatheredRoyalGray', their: ['Heather Royal Gray', 'Royal Blue', 'Heathered Royal Gry'] },
    { our: 'NavyBlazer', their: ['Navy Blazer', 'Navy Blue', 'Black'] },
    { our: 'TNFBlack', their: ['TNF Black', 'The North Face Black', 'Black'] },
    { our: 'JetBlack', their: ['Jet Black', 'Black', 'True Black'] },
    { our: 'TNFDarkGreyHeathe', their: ['TNFDkGyH', 'TNF Black', 'Dark Grey'] },
    { our: 'UrbanNavyHeather', their: ['UrbNvyHt', 'Navy', 'Urban Navy'] }
  ];

  const results = testCases.map(test => {
    const ourNormalized = normalizeColor(test.our);
    const colorChoices = test.their.map(c => ({ 
      original: c, 
      normalized: normalizeColor(c) 
    }));
    
    // Try fuzzy
    const fuzzyMatches = fuzz.extract(
      ourNormalized,
      colorChoices.map(c => c.normalized),
      {
        scorer: fuzz.token_sort_ratio,
        limit: 1
      }
    );
    
    const fuzzyBest = fuzzyMatches[0];
    let bestColor = colorChoices[fuzzyBest[2]].original;
    let confidence = fuzzyBest[1];
    let method = 'fuzzy';
    
    // Try consonant if low
    if (confidence < 75) {
      const ourConsonants = getConsonants(ourNormalized);
      const consonantChoices = colorChoices.map(c => ({
        original: c.original,
        consonants: getConsonants(c.normalized)
      }));
      
      const consonantMatches = fuzz.extract(
        ourConsonants,
        consonantChoices.map(c => c.consonants),
        {
          scorer: fuzz.ratio,
          limit: 1
        }
      );
      
      const consonantBest = consonantMatches[0];
      
      if (consonantBest[1] > confidence + 10) {
        bestColor = consonantChoices[consonantBest[2]].original;
        confidence = consonantBest[1];
        method = 'consonant';
      }
    }
    
    return {
      input: test.our,
      options: test.their,
      matched: bestColor,
      confidence: Math.round(confidence),
      method: method
    };
  });

  res.json({ testResults: results });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Color matching service running on port ${PORT}`);
  console.log(`Test it: curl http://localhost:${PORT}/health`);
});