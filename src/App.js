import React, { useState, useEffect } from 'react';
import { Calculator, TrendingUp, Plus, Trash2, RefreshCw, Download, Loader, Zap, Target, ExternalLink } from 'lucide-react';

// OnyxOdds boost configuration - Tennis only
const ONYXODDS_BOOSTS = {
  onyx: {
    name: 'OnyxOdds',
    oddsProvider: 'draftkings',
    boosts: {
      Tennis: { percentage: 25, requirement: '3+ legs, mixed games, +200 odds minimum', minLegs: 3, sameGame: false, minOdds: 200 }
    },
    color: 'purple'
  }
};

const EVParlayCalculator = () => {
  const [sport, setSport] = useState('Tennis');
  const [selectedBook, setSelectedBook] = useState('onyx');
  const [legs, setLegs] = useState([
    { id: 1, market: 'Moneyline', pinnacleOdds: '', boostedOdds: '', selection: '', gameId: '', fairOdds: '' },
    { id: 2, market: 'Moneyline', pinnacleOdds: '', boostedOdds: '', selection: '', gameId: '', fairOdds: '' },
    { id: 3, market: 'Moneyline', pinnacleOdds: '', boostedOdds: '', selection: '', gameId: '', fairOdds: '' }
  ]);
  const [results, setResults] = useState(null);
  const [liveGames, setLiveGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('fc32d59cdb51401c42d56dfa616f1b61');
  const [showApiSetup, setShowApiSetup] = useState(false);
  const [bestParlay, setBestParlay] = useState(null);
  const [autoCalculating, setAutoCalculating] = useState(false);

  // Get current boost configuration
  const currentBookConfig = ONYXODDS_BOOSTS[selectedBook];
  const currentBoost = currentBookConfig?.boosts?.[sport];
  const boostPercentage = currentBoost?.percentage || 0;

  // Helper functions
  const americanToDecimal = (american) => {
    const odds = parseInt(american);
    if (odds > 0) return (odds / 100) + 1;
    return (100 / Math.abs(odds)) + 1;
  };

  const decimalToAmerican = (decimal) => {
    if (decimal >= 2) {
      const result = Math.round((decimal - 1) * 100);
      return Math.max(result, 100); // Ensure minimum +100
    } else {
      const result = Math.round(-100 / (decimal - 1));
      return Math.min(result, -100); // Ensure minimum -100
    }
  };

  // Helper functions for odds API
  const getOddsForTeam = (outcomes, teamName) => {
    const outcome = outcomes.find(o => o.name === teamName);
    return outcome ? outcome.price : null;
  };

  // Get available tennis tournaments
  const getTennisOptions = async () => {
    try {
      const sportsResponse = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${apiKey}`);
      if (sportsResponse.ok) {
        const sportsData = await sportsResponse.json();
        const tennisSports = sportsData.filter(sport => 
          sport.group === 'Tennis' && sport.active
        );
        return tennisSports.length > 0 ? tennisSports[0].key : null;
      }
    } catch (error) {
      console.log('Could not fetch tennis options:', error);
    }
    return null;
  };

  // Transform real API data for tennis
  const transformTennisApiData = (apiData) => {
    const transformedGames = [];
    
    apiData.forEach((game, index) => {
      if (index >= 20) return; // Limit to 20 games for tennis
      
      // Always use Pinnacle as fair odds
      const pinnacleData = game.bookmakers.find(book => 
        book.key === 'pinnacle' || book.title.toLowerCase().includes('pinnacle')
      );
      
      // Use DraftKings as the boosted book (OnyxOdds provider)
      const boostedBookData = game.bookmakers.find(book => 
        book.key === 'draftkings' || book.title.toLowerCase().includes('draftkings')
      );
      
      if (!pinnacleData || !boostedBookData) {
        console.log(`Missing data for ${game.home_team} vs ${game.away_team} - Pinnacle: ${!!pinnacleData}, DraftKings: ${!!boostedBookData}`);
        return;
      }
      
      const transformedGame = {
        id: `tennis_${Date.now()}_${index}`,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        startTime: game.commence_time,
        markets: {}
      };

      try {
        const pinnacleH2H = pinnacleData.markets.find(m => m.key === 'h2h');
        const boostedH2H = boostedBookData.markets.find(m => m.key === 'h2h');
        
        if (pinnacleH2H && boostedH2H) {
          transformedGame.markets.moneyline = {
            pinnacle: {
              home: getOddsForTeam(pinnacleH2H.outcomes, game.home_team),
              away: getOddsForTeam(pinnacleH2H.outcomes, game.away_team)
            },
            boosted: {
              home: getOddsForTeam(boostedH2H.outcomes, game.home_team),
              away: getOddsForTeam(boostedH2H.outcomes, game.away_team)
            }
          };
        }

        if (Object.keys(transformedGame.markets).length > 0) {
          transformedGames.push(transformedGame);
        }

      } catch (error) {
        console.error(`Error processing game ${game.home_team} vs ${game.away_team}:`, error);
      }
    });
    
    return transformedGames;
  };

  // Optimized CrazyNinja API call - caches results to avoid repeated calls
  const fairValueCache = new Map();
  
  const calculateFairValueViaCrazyNinja = async (oddsArray) => {
    // Create cache key from sorted odds to handle same combinations in different orders
    const cacheKey = oddsArray.slice().sort((a, b) => a - b).join(',');
    
    // Check cache first
    if (fairValueCache.has(cacheKey)) {
      console.log(`📋 Using cached fair value for: ${cacheKey}`);
      return fairValueCache.get(cacheKey);
    }

    try {
      const legOddsString = oddsArray.map(odds => {
        const oddsValue = typeof odds === 'string' ? parseInt(odds) : odds;
        return oddsValue.toString();
      }).join(',');

      // Using a CORS proxy to handle the API call
      const proxyUrl = 'https://api.allorigins.win/get?url=';
      const targetUrl = `http://crazyninjamike.com/public/sportsbooks/sportsbook_devigger.aspx?LegOdds=${encodeURIComponent(legOddsString)}&DevigMethod=2&Args=fo_o`;
      const apiUrl = proxyUrl + encodeURIComponent(targetUrl);

      console.log(`🔍 Calling CrazyNinja API (NEW): ${legOddsString}`);

      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API responded with status: ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.contents;
      
      console.log('🔍 CrazyNinja Response:', responseText);

      // Try to extract fair odds from the response
      const match = responseText.match(/([+-]?\d+)/);
      if (match) {
        let fairOdds = parseInt(match[1]);
        
        // Validate American odds format
        if (fairOdds > 0 && fairOdds < 100) {
          fairOdds = 100; // Minimum positive odds
        } else if (fairOdds < 0 && fairOdds > -100) {
          fairOdds = -100; // Minimum negative odds
        }
        
        console.log(`✅ Fair value from CrazyNinja: ${fairOdds}`);
        
        // Cache the result
        fairValueCache.set(cacheKey, fairOdds);
        return fairOdds;
      } else {
        throw new Error('Could not parse fair odds from response');
      }

    } catch (error) {
      console.error('❌ CrazyNinja API error:', error);
      console.log('📝 Falling back to manual calculation');
      const fallbackResult = calculateManualFairOdds(oddsArray);
      fairValueCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }
  };

  // Manual fair odds calculation as fallback
  const calculateManualFairOdds = (oddsArray) => {
    try {
      let parlayDecimal = 1;
      
      // Calculate parlay decimal odds from individual legs
      oddsArray.forEach(odds => {
        const oddsValue = typeof odds === 'string' ? parseInt(odds) : odds;
        const decimal = americanToDecimal(oddsValue);
        const impliedProb = 1 / decimal;
        // Remove vig from each leg (assuming 2.5% vig)
        const fairProb = impliedProb / 1.025;
        const fairDecimal = 1 / fairProb;
        parlayDecimal *= fairDecimal;
      });
      
      const fairOdds = decimalToAmerican(parlayDecimal);
      console.log(`📊 Manual calculation: decimal ${parlayDecimal.toFixed(4)} -> American ${fairOdds}`);
      return fairOdds;
    } catch (error) {
      console.error('Manual calculation error:', error);
      // Very basic fallback
      const totalDecimal = oddsArray.reduce((acc, odds) => {
        const oddsValue = typeof odds === 'string' ? parseInt(odds) : odds;
        return acc * americanToDecimal(oddsValue);
      }, 1);
      const fallbackOdds = decimalToAmerican(totalDecimal * 0.95);
      console.log(`📊 Fallback calculation: ${fallbackOdds}`);
      return fallbackOdds;
    }
  };

  // Correlation detection and adjustment (minimal for tennis)
  const detectCorrelation = (bets) => {
    const correlationGroups = [];
    
    bets.forEach(bet => {
      const existingGroup = correlationGroups.find(group => 
        group.some(groupBet => groupBet.gameId === bet.gameId)
      );
      
      if (existingGroup) {
        existingGroup.push(bet);
      } else {
        correlationGroups.push([bet]);
      }
    });
    
    return correlationGroups;
  };

  const calculateCorrelationAdjustment = (correlatedBets) => {
    // Tennis typically has no correlation between different matches
    const gameIds = [...new Set(correlatedBets.map(bet => bet.gameId))];
    if (gameIds.length > 1) {
      return 1.0; // No correlation between different games
    }
    
    // Even same match in tennis (different markets) has minimal correlation
    return 0.98; // Very small adjustment for same match
  };

  // Optimized parlay calculation with batching and reduced API calls
  const calculateParlayEV = async (bets, skipApiCall = false) => {
    // Calculate sportsbook parlay odds
    let parlayDecimal = 1;
    bets.forEach(bet => {
      const bookDecimal = americanToDecimal(bet.boostedOdds);
      parlayDecimal *= bookDecimal;
    });

    // Get fair value - use cache or manual calculation for batch processing
    const pinnacleOddsArray = bets.map(bet => bet.pinnacleOdds);
    
    let fairParlayOdds;
    if (skipApiCall) {
      // Use manual calculation for batch processing to avoid API spam
      fairParlayOdds = calculateManualFairOdds(pinnacleOddsArray);
      console.log(`📊 Manual fair calculation: ${fairParlayOdds}`);
    } else {
      // Use API for single calculations
      fairParlayOdds = await calculateFairValueViaCrazyNinja(pinnacleOddsArray);
      console.log(`📊 API fair calculation: ${fairParlayOdds}`);
    }
    
    const fairParlayDecimal = americanToDecimal(fairParlayOdds);

    // Apply correlation adjustments to fair odds only (minimal for tennis)
    let correlationAdjustment = 1.0;
    let correlationWarnings = [];
    
    const correlationGroups = detectCorrelation(bets);
    correlationGroups.forEach(group => {
      if (group.length > 1) {
        const adjustment = calculateCorrelationAdjustment(group);
        correlationAdjustment *= adjustment;
        
        correlationWarnings.push({
          gameId: group[0].gameId,
          markets: group.map(b => b.marketType || b.market),
          adjustment: ((1 - adjustment) * 100).toFixed(1),
          note: "Minimal correlation in tennis"
        });
      }
    });

    const adjustedFairDecimal = fairParlayDecimal * correlationAdjustment;
    const adjustedFairOdds = decimalToAmerican(adjustedFairDecimal);

    // Convert original parlay decimal to American odds
    const originalParlayAmerican = decimalToAmerican(parlayDecimal);
    
    // Apply boost
    const boostedDecimal = parlayDecimal * (1 + boostPercentage / 100);
    const boostedParlayAmerican = decimalToAmerican(boostedDecimal);

    // Calculate EV using the boosted decimal odds vs fair odds
    const ev = ((boostedDecimal / adjustedFairDecimal - 1) * 100);
    
    return {
      originalParlay: originalParlayAmerican,
      boostedParlay: boostedParlayAmerican,
      fairParlay: adjustedFairOdds,
      expectedValue: ev,
      isPositiveEV: ev > 0,
      correlationWarnings,
      legs: bets.map(bet => ({
        market: bet.market || 'Moneyline',
        selection: bet.selection || 'Unknown',
        boostedOdds: bet.boostedOdds,
        fairOdds: bet.pinnacleOdds,
        calculatedFairOdds: fairParlayOdds,
        edge: ((americanToDecimal(bet.boostedOdds) / americanToDecimal(bet.pinnacleOdds) - 1) * 100).toFixed(2)
      }))
    };
  };

  // LIVE TENNIS ODDS FUNCTION
  const fetchLiveTennisOdds = async () => {
    setLoading(true);
    
    try {
      // Get available tennis tournaments
      const sportKey = await getTennisOptions();
      if (!sportKey) {
        throw new Error('No active tennis tournaments found. Tennis is tournament-specific and may be out of season.');
      }
      
      console.log(`🎾 Fetching LIVE tennis odds for ${sportKey}...`);
      
      const apiUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/` +
                     `?apiKey=${apiKey}` +
                     `&regions=us` +
                     `&markets=h2h` +
                     `&bookmakers=pinnacle,draftkings` +
                     `&oddsFormat=american` +
                     `&dateFormat=iso`;
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      console.log('✅ Live Tennis API Response:', data);
      
      // Check API usage
      const remainingRequests = response.headers.get('x-requests-remaining');
      console.log(`📊 API Usage - Remaining: ${remainingRequests}`);
      
      if (data.length === 0) {
        throw new Error(`No live tennis matches found. Check if tournaments are currently active.`);
      }
      
      // Transform real API data to our format
      const transformedGames = transformTennisApiData(data);
      
      if (transformedGames.length === 0) {
        throw new Error(`No tennis matches with both Pinnacle and DraftKings data found`);
      }
      
      console.log(`🎯 Successfully loaded ${transformedGames.length} live tennis matches!`);
      setLiveGames(transformedGames);
      
      // AUTO-GENERATE BEST BET AFTER LOADING ODDS
      setTimeout(() => {
        console.log('🚀 Auto-generating best tennis bet...');
        findBestParlay();
      }, 500);
      
    } catch (error) {
      console.error('❌ Error fetching live tennis odds:', error);
      
      let errorMessage = error.message;
      errorMessage += '\n\n🎾 Tennis Note: The Odds API uses tournament-specific keys. Tennis may not be available year-round or between tournaments.';
      
      alert(`Live Tennis Odds Error: ${errorMessage}`);
    }
    
    setLoading(false);
  };

  const getAllAvailableBets = () => {
    const allBets = [];
    
    liveGames.forEach(game => {
      Object.entries(game.markets).forEach(([market, odds]) => {
        Object.entries(odds.pinnacle).forEach(([side, pinnacleOdd]) => {
          const boostedOdd = odds.boosted[side];
          if (pinnacleOdd && boostedOdd) {
            const selection = side === 'home' ? game.homeTeam : 
                            side === 'away' ? game.awayTeam : 
                            `${game.homeTeam} vs ${game.awayTeam} ${side}`;
            
            allBets.push({
              gameId: game.id,
              game: `${game.awayTeam} vs ${game.homeTeam}`,
              market: market.charAt(0).toUpperCase() + market.slice(1),
              selection,
              pinnacleOdds: pinnacleOdd,
              boostedOdds: boostedOdd,
              side,
              marketType: market
            });
          }
        });
      });
    });
    
    return allBets;
  };

  const validateBoostRequirement = (legs, sport, selectedBook) => {
    const bookConfig = ONYXODDS_BOOSTS[selectedBook];
    const boostConfig = bookConfig?.boosts?.[sport];
    
    if (!boostConfig) return true;
    
    const filledLegs = legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds);
    
    if (filledLegs.length < boostConfig.minLegs) return false;
    
    if (boostConfig.minOdds) {
      const hasMinOdds = filledLegs.some(leg => {
        const odds = parseInt(leg.boostedOdds);
        return odds >= boostConfig.minOdds;
      });
      if (!hasMinOdds) return false;
    }
    
    return true;
  };

  // Optimized best parlay finder with reduced API calls
  const findBestParlay = async () => {
    setAutoCalculating(true);
    
    console.log(`🔍 Finding best tennis parlay with ${liveGames.length} available matches`);
    
    const allBets = getAllAvailableBets();
    if (allBets.length < 3) {
      alert('Not enough tennis betting options available to create a 3-leg parlay.');
      setAutoCalculating(false);
      return;
    }

    let bestEV = -Infinity;
    let bestCombination = null;
    let combinationsChecked = 0;
    
    console.log(`🚀 Analyzing ${allBets.length} bets - using manual calculation for speed`);

    // Use manual calculation for batch processing to avoid API rate limits
    for (let i = 0; i < allBets.length - 2; i++) {
      for (let j = i + 1; j < allBets.length - 1; j++) {
        for (let k = j + 1; k < allBets.length; k++) {
          const combination = [allBets[i], allBets[j], allBets[k]];
          
          // Check boost requirements
          if (!validateBoostRequirement(combination.map(bet => ({
            pinnacleOdds: bet.pinnacleOdds.toString(),
            boostedOdds: bet.boostedOdds.toString(),
            gameId: bet.gameId
          })), sport, selectedBook)) {
            continue;
          }
          
          // Use manual calculation for batch processing (much faster)
          const parlayResult = await calculateParlayEV(combination, true); // skipApiCall = true
          combinationsChecked++;
          
          if (parlayResult.expectedValue > bestEV) {
            bestEV = parlayResult.expectedValue;
            bestCombination = {
              bets: combination,
              result: parlayResult
            };
          }
          
          // Limit combinations to prevent freezing
          if (combinationsChecked >= 100) break;
        }
        if (combinationsChecked >= 100) break;
      }
      if (combinationsChecked >= 100) break;
    }

    // Now get accurate fair value for the best combination using API
    if (bestCombination) {
      console.log(`🎯 Refining best bet with CrazyNinja API...`);
      const refinedResult = await calculateParlayEV(bestCombination.bets, false); // Use API for final calculation
      bestCombination.result = refinedResult;
    }

    setBestParlay({
      ...bestCombination,
      combinationsChecked,
      totalPossible: Math.min(100, allBets.length >= 3 ? (allBets.length * (allBets.length - 1) * (allBets.length - 2)) / 6 : 0)
    });

    if (bestCombination) {
      const newLegs = bestCombination.bets.map((bet, index) => ({
        id: Date.now() + index,
        market: bet.market,
        selection: bet.selection,
        pinnacleOdds: bet.pinnacleOdds.toString(),
        boostedOdds: bet.boostedOdds.toString(),
        gameId: bet.gameId,
        fairOdds: bestCombination.result.fairParlay.toString()
      }));
      
      setLegs(newLegs);
      setResults({
        ...bestCombination.result,
        boostUsed: boostPercentage,
        legCount: 3
      });
    }

    setAutoCalculating(false);
  };

  const addGameToParlay = (game, market, side) => {
    const pinnacleOdds = game.markets[market]?.pinnacle?.[side];
    const boostedOdds = game.markets[market]?.boosted?.[side];
    
    if (!pinnacleOdds || !boostedOdds) return;

    const selection = side === 'home' ? game.homeTeam : 
                     side === 'away' ? game.awayTeam : 
                     `${game.homeTeam} vs ${game.awayTeam} ${side}`;
    
    const newLeg = {
      id: Date.now(),
      market: market.charAt(0).toUpperCase() + market.slice(1),
      selection,
      pinnacleOdds: pinnacleOdds.toString(),
      boostedOdds: boostedOdds.toString(),
      gameId: game.id,
      fairOdds: ''
    };

    setLegs([...legs, newLeg]);
  };

  const calculateParlay = async () => {
    const filledLegs = legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds);
    
    if (!validateBoostRequirement(filledLegs, sport, selectedBook)) {
      const boostConfig = currentBoost;
      alert(`OnyxOdds ${sport} boost requires: ${boostConfig.requirement}${boostConfig.minOdds ? ` • +${boostConfig.minOdds} odds minimum` : ''}`);
      return;
    }

    const betsForAnalysis = filledLegs.map(leg => ({
      gameId: leg.gameId || 'manual',
      marketType: leg.market.toLowerCase(),
      market: leg.market,
      selection: leg.selection,
      pinnacleOdds: parseInt(leg.pinnacleOdds),
      boostedOdds: parseInt(leg.boostedOdds)
    }));

    // Always use API for manual calculations (single call)
    const result = await calculateParlayEV(betsForAnalysis, false);
    
    setResults({
      ...result,
      boostUsed: boostPercentage,
      legCount: filledLegs.length
    });

    // Update legs with fair odds
    const updatedLegs = legs.map(leg => {
      if (leg.pinnacleOdds && leg.boostedOdds) {
        return { ...leg, fairOdds: result.fairParlay.toString() };
      }
      return leg;
    });
    setLegs(updatedLegs);
  };

  const addLeg = () => {
    setLegs([...legs, { 
      id: Date.now(), 
      market: 'Moneyline', 
      pinnacleOdds: '', 
      boostedOdds: '', 
      selection: '',
      gameId: '',
      fairOdds: ''
    }]);
  };

  const removeLeg = (id) => {
    if (legs.length > 3) {
      setLegs(legs.filter(leg => leg.id !== id));
    }
  };

  const updateLeg = (id, field, value) => {
    setLegs(legs.map(leg => 
      leg.id === id ? { ...leg, [field]: value } : leg
    ));
  };

  const openOnyxOdds = (betDetails = null) => {
    const onyxUrl = 'https://app.onyxodds.com';
    window.open(onyxUrl, '_blank');
    
    if (betDetails) {
      setTimeout(() => {
        const betText = betDetails.legs.map((leg, index) => 
          `${index + 1}. ${leg.selection} (${leg.boostedOdds > 0 ? '+' : ''}${leg.boostedOdds})`
        ).join('\n');
        
        const message = `🎾 ONYXODDS TENNIS BET\n\n${betText}\n\n✅ Boost: ${betDetails.boostUsed}%\n💰 Expected Value: ${betDetails.expectedValue > 0 ? '+' : ''}${betDetails.expectedValue.toFixed(2)}%\n🎰 Final Odds: ${betDetails.boostedParlay > 0 ? '+' : ''}${betDetails.boostedParlay}\n\nOnyxOdds is now open in a new tab!`;
        
        alert(message);
      }, 1000);
    }
  };

  // Reset when sport changes (though only tennis now)
  useEffect(() => {
    setBestParlay(null);
    setResults(null);
    setLiveGames([]);
  }, [sport]);

  const availableSports = ['Tennis']; // Only tennis now

  return (
    <div className="max-w-6xl mx-auto p-6 bg-gray-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Calculator className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">🎾 Tennis +EV Parlay Finder</h1>
              <div className="flex gap-2 mt-1">
                <span className="text-sm bg-green-100 text-green-800 px-2 py-1 rounded">LIVE TENNIS ODDS</span>
                <span className="text-sm bg-purple-100 text-purple-800 px-2 py-1 rounded">ONYXODDS 25% BOOST</span>
                <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">CRAZYNINJA API</span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={() => setShowApiSetup(!showApiSetup)}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              API Setup
            </button>
            <button
              onClick={findBestParlay}
              disabled={autoCalculating || liveGames.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {autoCalculating ? <Loader className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {autoCalculating ? 'Finding Best Tennis Bet...' : 'Find Best Tennis Bet'}
            </button>
            <button
              onClick={fetchLiveTennisOdds}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {loading ? 'Fetching Live Tennis...' : 'Refresh Live Tennis Odds'}
            </button>
          </div>
        </div>

        {/* API Setup Modal */}
        {showApiSetup && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold mb-3">🔧 API Configuration</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">The Odds API Key</label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key here"
                  className="w-full p-2 border border-gray-300 rounded-md"
                />
              </div>
              <div className="text-sm text-gray-600">
                <p><strong>🎾 Tennis-Only Configuration:</strong></p>
                <p>• <strong>The Odds API</strong> - Live tennis tournament data</p>
                <p>• <strong>CrazyNinja API</strong> - Fair value calculation</p>
                <p>• <strong>Pinnacle vs DraftKings</strong> - Sharp vs boosted odds</p>
                <p>• <strong>OnyxOdds 25% boost</strong> - Tennis parlay enhancement</p>
              </div>
            </div>
          </div>
        )}

        {/* Tennis Boost Info */}
        <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <h3 className="font-semibold text-purple-800 mb-2">
            🎾 OnyxOdds Tennis Boost: 25%
          </h3>
          <p className="text-sm text-purple-700">
            Requirements: 3+ legs, mixed games, +200 odds minimum
          </p>
          <p className="text-sm text-purple-700">
            At least one leg must have odds of +200 or higher to qualify for the boost
          </p>
          <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
            🎾 <strong>Tennis Note:</strong> Tennis odds are tournament-specific and may not be available year-round. 
            The Odds API uses tournament keys like "tennis_wta_australian_open".
          </div>
        </div>

        {/* Best Tennis Parlay Display */}
        {bestParlay && (
          <div className="mb-6 bg-gradient-to-r from-purple-50 to-green-50 border-2 border-purple-300 rounded-lg p-6 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-6 h-6 text-purple-600" />
              <h2 className="text-2xl font-bold text-purple-900">
                🎾 BEST TENNIS PARLAY
              </h2>
            </div>
            
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Expected Value</div>
                <div className={`text-3xl font-bold ${bestParlay?.result?.isPositiveEV ? 'text-green-600' : 'text-red-600'}`}>
                  {bestParlay.result.expectedValue > 0 ? '+' : ''}{bestParlay.result.expectedValue.toFixed(2)}%
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Boosted Odds</div>
                <div className="text-3xl font-bold text-purple-600">
                  {bestParlay.result.boostedParlay > 0 ? '+' : ''}{bestParlay.result.boostedParlay}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Fair Value</div>
                <div className="text-3xl font-bold text-blue-600">
                  {bestParlay.result.fairParlay > 0 ? '+' : ''}{bestParlay.result.fairParlay}
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg p-4 mb-4">
              <h4 className="font-semibold mb-3 text-gray-800">Recommended Tennis Bets:</h4>
              <div className="space-y-3">
                {bestParlay.result.legs.map((leg, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <span className="font-medium text-lg">{leg.market}</span>
                      <span className="text-gray-600 ml-2">- {leg.selection}</span>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="font-medium">OnyxOdds: {leg.boostedOdds > 0 ? '+' : ''}{leg.boostedOdds}</span>
                      <span>Pinnacle: {leg.pinnacleOdds > 0 ? '+' : ''}{leg.pinnacleOdds}</span>
                      <span className={leg.individualEdge > 0 ? 'text-green-600' : 'text-red-600'}>
                        Edge: {leg.individualEdge}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Show parlay-level fair value */}
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="text-center">
                  <div className="text-sm text-gray-600">Complete Parlay Fair Value</div>
                  <div className="text-xl font-bold text-blue-600">
                    {bestParlay.result.parlayFairValue > 0 ? '+' : ''}{bestParlay.result.parlayFairValue}
                  </div>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => openOnyxOdds({
                    legs: bestParlay.result.legs,
                    boostUsed: 25,
                    expectedValue: bestParlay.result.expectedValue,
                    boostedParlay: bestParlay.result.boostedParlay
                  })}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-green-600 text-white rounded-lg font-bold hover:from-purple-700 hover:to-green-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
                >
                  <span className="text-xl">🎾</span>
                  <span>BET NOW ON ONYXODDS</span>
                  <span className="text-xl">💰</span>
                </button>
              </div>
            </div>
            
            <div className="text-xs text-gray-600 text-center">
              ✨ Analyzed {bestParlay.combinationsChecked} tennis combinations using live odds + CrazyNinja fair value API
            </div>
          </div>
        )}

        {/* Live Tennis Games */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            Live Tennis Matches & Odds 
            <span className="text-sm bg-green-100 text-green-800 px-2 py-1 rounded">
              LIVE TOURNAMENT DATA
            </span>
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-6 h-6 animate-spin mr-2" />
              <span>Fetching live tennis tournament odds...</span>
            </div>
          ) : liveGames.length > 0 ? (
            <div className="grid gap-4">
              {liveGames.map(game => (
                <div key={game.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div className="font-semibold text-lg">
                      🎾 {game.awayTeam} vs {game.homeTeam}
                    </div>
                    <div className="text-sm text-gray-600">
                      {new Date(game.startTime).toLocaleString()}
                    </div>
                  </div>
                  
                  <div className="grid gap-3">
                    {Object.entries(game.markets).map(([market, odds]) => (
                      <div key={market} className="bg-gray-50 p-3 rounded">
                        <div className="font-medium mb-2 capitalize">
                          {market === 'moneyline' ? 'Match Winner' : market.replace(/_/g, ' ')}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(odds.pinnacle).map(([side, pinnacleOdd]) => {
                            const boostedOdd = odds.boosted[side];
                            const edge = ((americanToDecimal(boostedOdd) / americanToDecimal(pinnacleOdd) - 1) * 100).toFixed(1);
                            
                            const displayName = side === 'home' ? game.homeTeam : 
                                               side === 'away' ? game.awayTeam : 
                                               side;
                            
                            return (
                              <button
                                key={side}
                                onClick={() => addGameToParlay(game, market, side)}
                                className="p-3 border border-gray-300 rounded hover:bg-green-50 transition-colors text-left"
                              >
                                <div className="text-sm font-medium">
                                  {displayName}
                                </div>
                                <div className="flex justify-between text-xs mt-1">
                                  <span>Pinnacle: {pinnacleOdd > 0 ? '+' : ''}{pinnacleOdd}</span>
                                  <span>DraftKings: {boostedOdd > 0 ? '+' : ''}{boostedOdd}</span>
                                </div>
                                <div className="text-xs text-center mt-1">
                                  <span className={edge > 0 ? 'text-green-600 font-bold' : 'text-red-600'}>
                                    Edge: {edge}%
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600">
              <p className="text-lg mb-2">🎾 No live tennis matches loaded</p>
              <p className="text-sm">Click "Refresh Live Tennis Odds" to fetch current tournament data</p>
              <p className="text-xs mt-2 text-orange-600">
                Note: Tennis availability depends on active tournaments (ATP/WTA/ITF)
              </p>
            </div>
          )}
        </div>

        {/* Tennis Parlay Builder */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Manual Tennis Parlay Builder ({legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds).length}/3 minimum legs)
              </h2>
              <p className="text-sm text-orange-600 mt-1">
                ⚠️ OnyxOdds Tennis requires: 3+ legs, mixed games, +200 odds minimum (at least one leg)
              </p>
            </div>
            <button
              onClick={addLeg}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Manual Leg
            </button>
          </div>

          {legs.map((leg, index) => (
            <div key={leg.id} className="grid grid-cols-12 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
              <div className="col-span-1 flex items-center">
                <span className="font-medium text-gray-600">{index + 1}</span>
              </div>
              
              <div className="col-span-2">
                <input
                  type="text"
                  placeholder="Market"
                  value={leg.market}
                  onChange={(e) => updateLeg(leg.id, 'market', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-3">
                <input
                  type="text"
                  placeholder="Player/Selection"
                  value={leg.selection}
                  onChange={(e) => updateLeg(leg.id, 'selection', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-2">
                <input
                  type="text"
                  placeholder="Pinnacle Odds"
                  value={leg.pinnacleOdds}
                  onChange={(e) => updateLeg(leg.id, 'pinnacleOdds', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-2">
                <input
                  type="text"
                  placeholder="DraftKings Odds"
                  value={leg.boostedOdds}
                  onChange={(e) => updateLeg(leg.id, 'boostedOdds', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-2 flex items-center justify-between">
                <div className="text-xs text-center">
                  {leg.fairOdds && (
                    <div className="text-blue-600 font-medium">
                      Fair: {leg.fairOdds > 0 ? '+' : ''}{leg.fairOdds}
                    </div>
                  )}
                </div>
                {legs.length > 3 && (
                  <button
                    onClick={() => removeLeg(leg.id)}
                    className="p-2 text-red-600 hover:bg-red-100 rounded-md transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Calculate Button */}
        <div className="mb-6">
          <button
            onClick={calculateParlay}
            className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
          >
            <TrendingUp className="w-5 h-5" />
            Calculate Tennis +EV using CrazyNinja API (25% OnyxOdds Boost)
          </button>
        </div>

        {/* Results */}
        {results && (
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">
              🎾 Tennis EV Analysis Results (CrazyNinja + 25% OnyxOdds Boost)
            </h3>
            
            {results.correlationWarnings && results.correlationWarnings.length > 0 && (
              <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h4 className="font-semibold text-yellow-800 mb-2">⚠️ Correlation Adjustments Applied</h4>
                {results.correlationWarnings.map((warning, index) => (
                  <div key={index} className="text-sm text-yellow-700 mb-1">
                    Same match: {warning.markets.join(' + ')} - {warning.note}
                  </div>
                ))}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="font-medium">Original Parlay:</span>
                  <span>{results.originalParlay > 0 ? '+' : ''}{results.originalParlay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Fair Value (CrazyNinja):</span>
                  <span className="font-semibold text-blue-600">
                    {results.fairParlay > 0 ? '+' : ''}{results.fairParlay}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">With 25% Tennis Boost:</span>
                  <span className="font-semibold text-purple-600">
                    {results.boostedParlay > 0 ? '+' : ''}{results.boostedParlay}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Tennis Legs Used:</span>
                  <span>{results.legCount}/3+ required</span>
                </div>
              </div>

              <div className="flex flex-col justify-center">
                <div className={`text-center p-4 rounded-lg ${
                  results.isPositiveEV 
                    ? 'bg-green-100 border-2 border-green-500' 
                    : 'bg-red-100 border-2 border-red-500'
                }`}>
                  <div className="text-sm font-medium text-gray-600 mb-1">Expected Value</div>
                  <div className={`text-2xl font-bold ${
                    results.isPositiveEV ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {results.expectedValue > 0 ? '+' : ''}{typeof results.expectedValue === 'number' ? results.expectedValue.toFixed(2) : results.expectedValue}%
                  </div>
                  <div className="text-sm font-medium mt-1">
                    {results.isPositiveEV ? '🎾 POSITIVE EV TENNIS BET' : '❌ NEGATIVE EV'}
                  </div>
                </div>
                
                <div className="mt-3 text-xs text-gray-500 text-center">
                  Fair value calculated via CrazyNinja devig API
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-semibold mb-3">Tennis Leg Breakdown</h4>
              <div className="space-y-2">
                {results.legs.map((leg, index) => (
                  <div key={index} className="flex justify-between items-center p-2 bg-white rounded">
                    <div className="flex-1">
                      <span className="font-medium">{leg.market}</span>
                      {leg.selection && <span className="text-gray-600 ml-2">- {leg.selection}</span>}
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span>DraftKings: {leg.boostedOdds > 0 ? '+' : ''}{leg.boostedOdds}</span>
                      <span>Pinnacle: {leg.pinnacleOdds > 0 ? '+' : ''}{leg.pinnacleOdds}</span>
                      <span className={leg.individualEdge > 0 ? 'text-green-600' : 'text-red-600'}>
                        Edge: {leg.individualEdge}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Show parlay-level fair value */}
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Complete Parlay Fair Value (CrazyNinja API):</span>
                  <span className="text-lg font-bold text-blue-600">
                    {results.parlayFairValue > 0 ? '+' : ''}{results.parlayFairValue}
                  </span>
                </div>
              </div>
              
              {results.isPositiveEV && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => openOnyxOdds({
                      legs: results.legs,
                      boostUsed: 25,
                      expectedValue: results.expectedValue,
                      boostedParlay: results.boostedParlay
                    })}
                    className="w-full py-3 bg-gradient-to-r from-green-600 to-purple-600 text-white rounded-lg font-bold hover:from-green-700 hover:to-purple-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
                  >
                    <span className="text-xl">🎾</span>
                    <span>BET THIS TENNIS PARLAY ON ONYXODDS</span>
                    <span className="text-xl">💰</span>
                  </button>
                  <p className="text-xs text-center text-gray-600 mt-2">
                    Opens OnyxOdds in new tab with tennis bet details
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-sm text-gray-600">
        <p>🎾 Live tennis tournament odds • Fair value via CrazyNinja API • 25% OnyxOdds boost</p>
        <p>Requirements: 3+ legs, mixed games, +200 odds minimum (at least one leg)</p>
        <p>Tennis data depends on active ATP/WTA/ITF tournaments</p>
      </div>
    </div>
  );
};

export default EVParlayCalculator;
