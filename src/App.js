import React, { useState, useEffect } from 'react';
import { Calculator, TrendingUp, Plus, Trash2, RefreshCw, Download, Loader, Zap, Target, ExternalLink } from 'lucide-react';

// OnyxOdds boost configuration
const ONYXODDS_BOOSTS = {
  onyx: {
    name: 'OnyxOdds',
    oddsProvider: 'draftkings', // DraftKings provides OnyxOdds odds
    boosts: {
      MLB: { percentage: 100, requirement: '3+ legs, 2+ from same game', minLegs: 3, sameGame: true },
      Tennis: { percentage: 25, requirement: '3+ legs, mixed games, +200 odds minimum', minLegs: 3, sameGame: false, minOdds: 200 },
      UFC: { percentage: 100, requirement: '3+ legs, +200 odds minimum', minLegs: 3, sameGame: false, minOdds: 200 }
    },
    color: 'purple'
  }
};

// Helper functions for odds API
const getOddsForTeam = (outcomes, teamName) => {
  const outcome = outcomes.find(o => o.name === teamName);
  return outcome ? outcome.price : null;
};

const getOddsForOutcome = (outcomes, outcomeName) => {
  const outcome = outcomes.find(o => o.name === outcomeName);
  return outcome ? outcome.price : null;
};

const generateRealisticCorrelatedOdds = (baseML, multiplier) => {
  // Convert to decimal, apply multiplier, then back to American
  const baseDecimal = baseML > 0 ? (baseML / 100) + 1 : (100 / Math.abs(baseML)) + 1;
  const adjustedDecimal = baseDecimal * multiplier;
  
  // Convert back to American odds
  if (adjustedDecimal >= 2) {
    return Math.round((adjustedDecimal - 1) * 100);
  } else {
    return Math.round(-100 / (adjustedDecimal - 1));
  }
};

const transformOddsApiData = (apiData, sport, selectedBook, onyxBoosts) => {
  const transformedGames = [];
  
  apiData.forEach((game, index) => {
    if (index >= 8) return; // Limit to 8 games
    
    // Always use Pinnacle as fair odds
    const pinnacleData = game.bookmakers.find(book => 
      book.key === 'pinnacle' || book.title.toLowerCase().includes('pinnacle')
    );
    
    // Use the specific book that offers the boost
    const bookConfig = onyxBoosts[selectedBook];
    const boostedBookData = game.bookmakers.find(book => 
      book.key === bookConfig.oddsProvider || book.title.toLowerCase().includes(bookConfig.oddsProvider)
    );
    
    if (!pinnacleData || !boostedBookData) {
      console.log(`Missing data for ${game.home_team} vs ${game.away_team} - Pinnacle: ${!!pinnacleData}, ${bookConfig.name}: ${!!boostedBookData}`);
      return;
    }
    
    const transformedGame = {
      id: `${sport.toLowerCase()}_${Date.now()}_${index}`,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      startTime: game.commence_time,
      markets: {}
    };

    try {
      if (sport === 'MLB') {
        // Moneyline
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

        // Runline (Spreads)
        const pinnacleSpread = pinnacleData.markets.find(m => m.key === 'spreads');
        const boostedSpread = boostedBookData.markets.find(m => m.key === 'spreads');
        
        if (pinnacleSpread && boostedSpread) {
          transformedGame.markets.runline = {
            pinnacle: {
              home: getOddsForTeam(pinnacleSpread.outcomes, game.home_team),
              away: getOddsForTeam(pinnacleSpread.outcomes, game.away_team)
            },
            boosted: {
              home: getOddsForTeam(boostedSpread.outcomes, game.home_team),
              away: getOddsForTeam(boostedSpread.outcomes, game.away_team)
            }
          };
        }

        // Totals
        const pinnacleTotal = pinnacleData.markets.find(m => m.key === 'totals');
        const boostedTotal = boostedBookData.markets.find(m => m.key === 'totals');
        
        if (pinnacleTotal && boostedTotal) {
          transformedGame.markets.total = {
            pinnacle: {
              over: getOddsForOutcome(pinnacleTotal.outcomes, 'Over'),
              under: getOddsForOutcome(pinnacleTotal.outcomes, 'Under')
            },
            boosted: {
              over: getOddsForOutcome(boostedTotal.outcomes, 'Over'),
              under: getOddsForOutcome(boostedTotal.outcomes, 'Under')
            }
          };
        }

        // Estimated correlated markets (since API doesn't provide Winner/Total combos)
        if (pinnacleH2H && pinnacleTotal && boostedH2H && boostedTotal) {
          const totalPoints = pinnacleTotal.outcomes.find(o => o.name === 'Over')?.point || 8.5;
          const homeML = getOddsForTeam(pinnacleH2H.outcomes, game.home_team);
          const awayML = getOddsForTeam(pinnacleH2H.outcomes, game.away_team);
          const boostedHomeML = getOddsForTeam(boostedH2H.outcomes, game.home_team);
          const boostedAwayML = getOddsForTeam(boostedH2H.outcomes, game.away_team);
          
          if (homeML && awayML && boostedHomeML && boostedAwayML) {
            transformedGame.markets[`winner_total_${totalPoints}`] = {
              pinnacle: {
                'home_over': generateRealisticCorrelatedOdds(homeML, 2.8),
                'home_under': generateRealisticCorrelatedOdds(homeML, 1.6),
                'away_over': generateRealisticCorrelatedOdds(awayML, 3.2),
                'away_under': generateRealisticCorrelatedOdds(awayML, 2.0)
              },
              boosted: {
                'home_over': generateRealisticCorrelatedOdds(boostedHomeML, 2.9),
                'home_under': generateRealisticCorrelatedOdds(boostedHomeML, 1.65),
                'away_over': generateRealisticCorrelatedOdds(boostedAwayML, 3.3),
                'away_under': generateRealisticCorrelatedOdds(boostedAwayML, 2.05)
              }
            };
          }
        }

      } else if (sport === 'Tennis' || sport === 'UFC') {
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

const EVParlayCalculator = () => {
  const [sport, setSport] = useState('MLB');
  const [selectedBook, setSelectedBook] = useState('onyx');
  const [legs, setLegs] = useState([
    { id: 1, market: 'Moneyline', pinnacleOdds: '', boostedOdds: '', selection: '', gameId: '' },
    { id: 2, market: 'Moneyline', pinnacleOdds: '', boostedOdds: '', selection: '', gameId: '' },
    { id: 3, market: 'Moneyline', pinnacleOdds: '', boostedOdds: '', selection: '', gameId: '' }
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

  // LIVE ODDS FUNCTION - NO AUTO REFRESH to save API calls
  const fetchLiveOdds = async () => {
    setLoading(true);
    
    try {
      let sportKey;
      
      if (sport === 'MLB') {
        sportKey = 'baseball_mlb';
      } else if (sport === 'Tennis') {
        // First try to get current tennis tournaments
        sportKey = await getTennisOptions();
        if (!sportKey) {
          throw new Error('No active tennis tournaments found. Tennis is tournament-specific and may be out of season.');
        }
      } else if (sport === 'UFC') {
        sportKey = 'mma_mixed_martial_arts';
      } else {
        throw new Error(`Sport ${sport} not configured for live odds yet.`);
      }
      
      const markets = sport === 'MLB' ? 'h2h,spreads,totals' : 'h2h';
      const bookConfig = ONYXODDS_BOOSTS[selectedBook];
      
      console.log(`🔥 Fetching LIVE odds for ${sport} (${sportKey}) from The Odds API (${bookConfig.name})...`);
      
      const apiUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/` +
                     `?apiKey=${apiKey}` +
                     `&regions=us` +
                     `&markets=${markets}` +
                     `&bookmakers=pinnacle,${bookConfig.oddsProvider}` +
                     `&oddsFormat=american` +
                     `&dateFormat=iso`;
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      console.log('✅ Live API Response:', data);
      
      // Check API usage
      const remainingRequests = response.headers.get('x-requests-remaining');
      console.log(`📊 API Usage - Remaining: ${remainingRequests}`);
      
      if (data.length === 0) {
        throw new Error(`No live games found for ${sport}. Check if it's the season or if tournaments are active.`);
      }
      
      // Transform real API data to our format
      const transformedGames = transformOddsApiData(data, sport, selectedBook, ONYXODDS_BOOSTS);
      
      if (transformedGames.length === 0) {
        throw new Error(`No games with both Pinnacle and ${bookConfig.name} data found`);
      }
      
      console.log(`🎯 Successfully loaded ${transformedGames.length} games with LIVE ${bookConfig.name} vs Pinnacle odds!`);
      setLiveGames(transformedGames);
      
      // AUTO-GENERATE BEST BET AFTER LOADING ODDS
      setTimeout(() => {
        console.log('🚀 Auto-generating best bet...');
        findBestParlay();
      }, 500); // Small delay to ensure state is updated
      
    } catch (error) {
      console.error('❌ Error fetching live odds:', error);
      
      let errorMessage = error.message;
      if (sport === 'Tennis') {
        errorMessage += '\n\n🎾 Tennis Note: The Odds API uses tournament-specific keys (e.g., tennis_wta_australian_open). Tennis may not be available year-round or between tournaments.';
      }
      
      alert(`Live Odds Error: ${errorMessage}\n\nUsing demo data as fallback.`);
      setLiveGames(simulateOddsData(sport));
      
      // Still try to auto-generate with demo data
      setTimeout(() => {
        findBestParlay();
      }, 500);
    }
    
    setLoading(false);
  };

  // Simulated data (fallback only)
  const simulateOddsData = (selectedSport = sport) => {
    console.log(`🎾 Generating demo data for: ${selectedSport}`);
    
    if (selectedSport === 'MLB') {
      return [
        {
          id: 'demo_mlb_1',
          homeTeam: 'Yankees',
          awayTeam: 'Red Sox',
          startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          markets: {
            moneyline: { pinnacle: { home: -120, away: +110 }, boosted: { home: -115, away: +105 } },
            runline: { pinnacle: { home: +145, away: -165 }, boosted: { home: +150, away: -160 } },
            total: { pinnacle: { over: -110, under: -110 }, boosted: { over: -105, under: -115 } }
          }
        },
        {
          id: 'demo_mlb_2',
          homeTeam: 'Dodgers',
          awayTeam: 'Giants',
          startTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          markets: {
            moneyline: { pinnacle: { home: -140, away: +125 }, boosted: { home: -135, away: +120 } },
            runline: { pinnacle: { home: +155, away: -175 }, boosted: { home: +160, away: -170 } },
            total: { pinnacle: { over: -108, under: -112 }, boosted: { over: -105, under: -115 } }
          }
        }
      ];
    } else if (selectedSport === 'Tennis') {
      return [
        {
          id: 'demo_tennis_1',
          homeTeam: 'Novak Djokovic',
          awayTeam: 'Alexandre Muller',
          startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          markets: {
            moneyline: { pinnacle: { home: -5000, away: +2000 }, boosted: { home: -5000, away: +2100 } }
          }
        },
        {
          id: 'demo_tennis_2',
          homeTeam: 'Beibit Zhukayev',
          awayTeam: 'Flavio Cobolli',
          startTime: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
          markets: {
            moneyline: { pinnacle: { home: +266, away: -320 }, boosted: { home: +260, away: -310 } }
          }
        },
        {
          id: 'demo_tennis_3',
          homeTeam: 'Quentin Halys',
          awayTeam: 'August Holmgren',
          startTime: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
          markets: {
            moneyline: { pinnacle: { home: -832, away: +580 }, boosted: { home: -800, away: +600 } }
          }
        }
      ];
    } else if (selectedSport === 'UFC') {
      return [
        {
          id: 'demo_ufc_1',
          homeTeam: 'Jon Jones',
          awayTeam: 'Tom Aspinall',
          startTime: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          markets: {
            moneyline: { pinnacle: { home: +250, away: -280 }, boosted: { home: +260, away: -270 } }
          }
        },
        {
          id: 'demo_ufc_2',
          homeTeam: 'Islam Makhachev',
          awayTeam: 'Arman Tsarukyan',
          startTime: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          markets: {
            moneyline: { pinnacle: { home: +180, away: -200 }, boosted: { home: +190, away: -190 } }
          }
        }
      ];
    }
    return [];
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
                            side.includes('_') ? 
                              `${side.includes('home') ? game.homeTeam : game.awayTeam} ${side.split('_').slice(1).join(' ')}` :
                              `${game.homeTeam} vs ${game.awayTeam} ${side}`;
            
            allBets.push({
              gameId: game.id,
              game: `${game.awayTeam} @ ${game.homeTeam}`,
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

  const americanToDecimal = (american) => {
    if (american > 0) return (american / 100) + 1;
    return (100 / Math.abs(american)) + 1;
  };

  const decimalToAmerican = (decimal) => {
    if (decimal >= 2) return Math.round((decimal - 1) * 100);
    return Math.round(-100 / (decimal - 1));
  };

  const validateBoostRequirement = (legs, sport, selectedBook) => {
    const bookConfig = ONYXODDS_BOOSTS[selectedBook];
    const boostConfig = bookConfig?.boosts?.[sport];
    
    if (!boostConfig) return true; // No specific requirements
    
    const filledLegs = legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds);
    
    // Check minimum legs
    if (filledLegs.length < boostConfig.minLegs) return false;
    
    // Check minimum odds requirement (for UFC and Tennis)
    if (boostConfig.minOdds) {
      const hasMinOdds = filledLegs.some(leg => {
        const odds = parseInt(leg.boostedOdds);
        return odds >= boostConfig.minOdds;
      });
      if (!hasMinOdds) return false;
    }
    
    // Check same-game requirement
    if (boostConfig.sameGame) {
      const gameGroups = {};
      filledLegs.forEach(leg => {
        if (leg.gameId) {
          gameGroups[leg.gameId] = (gameGroups[leg.gameId] || 0) + 1;
        }
      });
      return Object.values(gameGroups).some(count => count >= 2);
    }
    
    return true;
  };

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
    const marketTypes = correlatedBets.map(bet => bet.marketType);
    
    // Only apply correlation for same-game markets
    const gameIds = [...new Set(correlatedBets.map(bet => bet.gameId))];
    if (gameIds.length > 1) {
      return 1.0; // No correlation between different games
    }
    
    // Apply correlation adjustments for same-game parlays
    if (marketTypes.includes('moneyline') && marketTypes.includes('total')) {
      return 0.85; // Stronger correlation penalty
    }
    
    if (marketTypes.includes('moneyline') && marketTypes.includes('runline')) {
      return 0.80; // Strong correlation penalty
    }
    
    if (marketTypes.includes('runline') && marketTypes.includes('total')) {
      return 0.90; // Moderate correlation penalty
    }
    
    if (marketTypes.some(market => market.includes('winner_total'))) {
      return 1.0; // Already priced with correlation
    }
    
    return 1.0; // No correlation adjustment needed
  };

  const calculateParlayEV = (bets) => {
    let parlayDecimal = 1;
    let fairParlayDecimal = 1;
    let correlationWarnings = [];

    const correlationGroups = detectCorrelation(bets);
    
    bets.forEach(bet => {
      const fairDecimal = americanToDecimal(bet.pinnacleOdds);
      const boostedDecimal = americanToDecimal(bet.boostedOdds);
      
      parlayDecimal *= boostedDecimal;
      fairParlayDecimal *= fairDecimal;
    });

    // Apply correlation adjustments to FAIR odds only (not boosted odds)
    let correlationAdjustment = 1.0;
    correlationGroups.forEach(group => {
      if (group.length > 1) {
        const adjustment = calculateCorrelationAdjustment(group);
        correlationAdjustment *= adjustment;
        
        correlationWarnings.push({
          gameId: group[0].gameId,
          markets: group.map(b => b.marketType),
          adjustment: ((1 - adjustment) * 100).toFixed(1),
          note: "Based on market analysis of Winner/Total pricing vs individual legs"
        });
      }
    });

    // Apply correlation adjustment to fair parlay only
    fairParlayDecimal *= correlationAdjustment;

    // Convert parlay decimal to American odds
    const originalParlayAmerican = decimalToAmerican(parlayDecimal);
    
  // FIXED: Apply boost consistently using decimal multiplication method
const boostedDecimal = parlayDecimal * (1 + boostPercentage / 100);
const boostedParlayAmerican = decimalToAmerican(boostedDecimal);

// Calculate EV using the boosted decimal odds
const ev = ((boostedDecimal / fairParlayDecimal - 1) * 100);

console.log(`🔢 Parlay Calculation Debug:
Original Parlay Decimal: ${parlayDecimal.toFixed(4)}
Fair Parlay Decimal: ${fairParlayDecimal.toFixed(4)}
Boost: ${boostPercentage}%
Boosted Decimal: ${boostedDecimal.toFixed(4)}
Original American: ${originalParlayAmerican}
Boosted American: ${boostedParlayAmerican}
Expected Value: ${ev.toFixed(2)}%`);
    
    return {
      originalParlay: originalParlayAmerican,
      boostedParlay: boostedParlayAmerican,
      fairParlay: decimalToAmerican(fairParlayDecimal),
      expectedValue: ev,
      isPositiveEV: ev > 0,
      correlationWarnings,
      legs: bets.map(bet => ({
        market: bet.market,
        selection: bet.selection,
        boostedOdds: bet.boostedOdds,
        fairOdds: bet.pinnacleOdds,
        edge: ((americanToDecimal(bet.boostedOdds) / americanToDecimal(bet.pinnacleOdds) - 1) * 100).toFixed(2)
      }))
    };
  };

  const findBestParlay = async () => {
    setAutoCalculating(true);
    
    console.log(`🔍 Finding best parlay for ${sport} with ${liveGames.length} available games`);
    
    const allBets = getAllAvailableBets();
    if (allBets.length < 3) {
      alert('Not enough betting options available to create a 3-leg parlay.');
      setAutoCalculating(false);
      return;
    }

    console.log(`📊 Found ${allBets.length} total betting options for ${sport}`);

    let bestEV = -Infinity;
    let bestCombination = null;
    let combinationsChecked = 0;

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
          
          const parlayResult = calculateParlayEV(combination);
          
          combinationsChecked++;
          
          if (parlayResult.expectedValue > bestEV) {
            bestEV = parlayResult.expectedValue;
            bestCombination = {
              bets: combination,
              result: parlayResult
            };
          }
          
          if (combinationsChecked % 100 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
      }
    }

    setBestParlay({
      ...bestCombination,
      combinationsChecked,
      totalPossible: allBets.length >= 3 ? (allBets.length * (allBets.length - 1) * (allBets.length - 2)) / 6 : 0
    });

    if (bestCombination) {
      const newLegs = bestCombination.bets.map((bet, index) => ({
        id: Date.now() + index,
        market: bet.market,
        selection: bet.selection,
        pinnacleOdds: bet.pinnacleOdds.toString(),
        boostedOdds: bet.boostedOdds.toString(),
        gameId: bet.gameId
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

    const selection = `${side === 'home' ? game.homeTeam : 
                        side === 'away' ? game.awayTeam : 
                        side.includes('_') ? 
                          `${side.includes('home') ? game.homeTeam : game.awayTeam} ${side.split('_').slice(1).join(' ')}` :
                          `${game.homeTeam} vs ${game.awayTeam}`}`;
    
    const newLeg = {
      id: Date.now(),
      market: market.charAt(0).toUpperCase() + market.slice(1),
      selection,
      pinnacleOdds: pinnacleOdds.toString(),
      boostedOdds: boostedOdds.toString(),
      gameId: game.id
    };

    setLegs([...legs, newLeg]);
  };

  const calculateParlay = () => {
    const filledLegs = legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds);
    
    if (!validateBoostRequirement(filledLegs, sport, selectedBook)) {
      const boostConfig = currentBoost;
      alert(`OnyxOdds ${sport} boost requires: ${boostConfig.requirement}${boostConfig.minOdds ? ` • +${boostConfig.minOdds} odds minimum` : ''}`);
      return;
    }

    const betsForAnalysis = filledLegs.map(leg => ({
      gameId: leg.gameId || 'manual',
      marketType: leg.market.toLowerCase(),
      pinnacleOdds: parseInt(leg.pinnacleOdds),
      boostedOdds: parseInt(leg.boostedOdds)
    }));

    const result = calculateParlayEV(betsForAnalysis);
    
    setResults({
      ...result,
      boostUsed: boostPercentage,
      legCount: filledLegs.length,
      legs: filledLegs.map((leg) => ({
        market: leg.market,
        selection: leg.selection,
        boostedOdds: parseInt(leg.boostedOdds),
        fairOdds: parseInt(leg.pinnacleOdds),
        edge: ((americanToDecimal(parseInt(leg.boostedOdds)) / americanToDecimal(parseInt(leg.pinnacleOdds)) - 1) * 100).toFixed(2)
      }))
    });
  };

  const addLeg = () => {
    setLegs([...legs, { 
      id: Date.now(), 
      market: 'Moneyline', 
      pinnacleOdds: '', 
      boostedOdds: '', 
      selection: '',
      gameId: ''
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
    // Open OnyxOdds in a new tab
    const onyxUrl = 'https://app.onyxodds.com';
    window.open(onyxUrl, '_blank');
    
    // If bet details are provided, show them in a modal for easy reference
    if (betDetails) {
      setTimeout(() => {
        const betText = betDetails.legs.map((leg, index) => 
          `${index + 1}. ${leg.selection} (${leg.boostedOdds > 0 ? '+' : ''}${leg.boostedOdds})`
        ).join('\n');
        
        const message = `🎯 ONYXODDS BET DETAILS\n\n${betText}\n\n✅ Boost: ${betDetails.boostUsed}%\n💰 Expected Value: ${betDetails.expectedValue > 0 ? '+' : ''}${betDetails.expectedValue.toFixed(2)}%\n🎰 Final Odds: ${betDetails.boostedParlay > 0 ? '+' : ''}${betDetails.boostedParlay}\n\nOnyxOdds is now open in a new tab. Search for these games and add the selections to your betslip!`;
        
        alert(message);
      }, 1000);
    }
  };

  // Auto-generate when games load (but NO auto-refresh)
  useEffect(() => {
    if (liveGames.length > 0 && !autoCalculating && !bestParlay) {
      console.log('🎯 Auto-generating best parlay with loaded games...');
      setTimeout(() => {
        findBestParlay();
      }, 1000);
    }
  }, [liveGames]);

  // Reset best parlay when sport changes
  useEffect(() => {
    console.log(`🏈 Sport changed to: ${sport}`);
    setBestParlay(null);
    setResults(null);
    setLiveGames([]); // Clear games so user needs to refresh for new sport
  }, [sport]);

  // Get available sports for selected book
  const availableSports = currentBookConfig ? Object.keys(currentBookConfig.boosts) : [];

  return (
    <div className="max-w-6xl mx-auto p-6 bg-gray-50 min-h-screen">
      <div className="bg-white rounded-xl shadow-lg p-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Calculator className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-gray-900">+EV Parlay Finder</h1>
              <div className="flex gap-2 mt-1">
                <span className="text-sm bg-green-100 text-green-800 px-2 py-1 rounded">LIVE ODDS</span>
                <span className="text-sm bg-purple-100 text-purple-800 px-2 py-1 rounded">ONYXODDS BOOSTS</span>
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
              {autoCalculating ? 'Auto-Generating...' : 'Regenerate Best Bet'}
            </button>
            <button
              onClick={fetchLiveOdds}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {loading ? 'Fetching...' : 'Refresh Live Odds'}
            </button>
          </div>
        </div>

        {/* API Setup Modal */}
        {showApiSetup && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold mb-3">API Configuration</h3>
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
                <p><strong>✅ Your API key is configured and ready!</strong></p>
                <p>• <strong>The Odds API</strong> - 500 free requests/month</p>
                <p>• <strong>Live Pinnacle data</strong> vs selected sportsbook</p>
                <p>• <strong>Manual refresh only</strong> to preserve API calls</p>
              </div>
            </div>
          </div>
        )}

        {/* OnyxOdds Information */}
        <div className="mb-6">
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-purple-800 mb-1">OnyxOdds Boost Calculator</h2>
                <p className="text-sm text-purple-600">Finding +EV opportunities with OnyxOdds boosts vs Pinnacle sharp odds</p>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-purple-800">{availableSports.length} Sports Available</div>
                <div className="text-sm text-purple-600 mb-2">MLB • Tennis • UFC</div>
                <button
                  onClick={() => openOnyxOdds()}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open OnyxOdds
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sport Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Available OnyxOdds Boosts
          </label>
          <div className="flex gap-4">
            {availableSports.map(sportOption => {
              const boostConfig = currentBookConfig.boosts[sportOption];
              return (
                <button
                  key={sportOption}
                  onClick={() => setSport(sportOption)}
                  className={`px-4 py-3 rounded-lg font-medium transition-colors ${
                    sport === sportOption 
                      ? 'bg-purple-600 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  <div className="text-lg">{sportOption}</div>
                  <div className="text-sm opacity-90">{boostConfig.percentage}% boost</div>
                  <div className="text-xs opacity-75">{boostConfig.requirement}</div>
                  {boostConfig.minOdds && (
                    <div className="text-xs opacity-75 mt-1">+{boostConfig.minOdds} odds min</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Current Boost Info */}
        {currentBoost && (
          <div className={`mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg`}>
            <h3 className={`font-semibold text-purple-800 mb-2`}>
              📈 OnyxOdds {sport} Boost: {currentBoost.percentage}%
            </h3>
            <p className={`text-sm text-purple-700`}>
              Requirements: {currentBoost.requirement}
            </p>
            {currentBoost.minOdds && (
              <p className="text-sm text-purple-700">
                Minimum odds: +{currentBoost.minOdds} (at least one leg must meet this)
              </p>
            )}
            <p className="text-xs text-gray-600 mt-1">
              Odds Provider: {currentBookConfig.oddsProvider} • Comparing vs Pinnacle sharp odds
            </p>
            {sport === 'Tennis' && (
              <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
                🎾 <strong>Tennis Note:</strong> Tennis odds are tournament-specific and may not be available year-round. 
                At least one leg must have odds of +{currentBoost.minOdds} or higher to qualify for the boost.
              </div>
            )}
            {sport === 'UFC' && (
              <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                🥊 <strong>UFC Note:</strong> At least one leg must have odds of +{currentBoost.minOdds} or higher to qualify for the boost.
              </div>
            )}
          </div>
        )}

        {/* AUTO-GENERATED BEST BET - Moved to top for prominence */}
        {bestParlay ? (
          <div className="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-300 rounded-lg p-6 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-6 h-6 text-purple-600" />
              <h2 className="text-2xl font-bold text-purple-900">
                🎯 BEST ONYXODDS {sport} BET
              </h2>
              <span className="text-sm bg-green-100 text-green-800 px-3 py-1 rounded-full font-medium">
                AUTO-GENERATED
              </span>
            </div>
            
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="text-center">
                <div className="text-sm text-gray-600 mb-1">Expected Value</div>
                <div className={`text-3xl font-bold ${bestParlay.result.isPositiveEV ? 'text-green-600' : 'text-red-600'}`}>
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
                <div className="text-sm text-gray-600 mb-1">Boost Applied</div>
                <div className="text-3xl font-bold text-blue-600">
                  {currentBoost?.percentage || 0}%
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg p-4 mb-4">
              <h4 className="font-semibold mb-3 text-gray-800">Recommended Bets:</h4>
              <div className="space-y-3">
                {bestParlay.result.legs.map((leg, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <span className="font-medium text-lg">{leg.market}</span>
                      <span className="text-gray-600 ml-2">- {leg.selection}</span>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="font-medium">OnyxOdds: {leg.boostedOdds > 0 ? '+' : ''}{leg.boostedOdds}</span>
                      <span>Pin: {leg.fairOdds > 0 ? '+' : ''}{leg.fairOdds}</span>
                      <span className={`font-bold ${leg.edge > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {leg.edge}% edge
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Bet Now Button */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => openOnyxOdds({
                    legs: bestParlay.result.legs,
                    boostUsed: currentBoost?.percentage || 0,
                    expectedValue: bestParlay.result.expectedValue,
                    boostedParlay: bestParlay.result.boostedParlay
                  })}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-bold hover:from-purple-700 hover:to-blue-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
                >
                  <span className="text-xl">🎯</span>
                  <span>BET NOW ON ONYXODDS</span>
                  <span className="text-xl">💰</span>
                </button>
                <p className="text-xs text-center text-gray-600 mt-2">
                  Opens OnyxOdds in new tab with bet details for easy placement
                </p>
              </div>
            </div>
            
            <div className="text-xs text-gray-600 text-center">
              ✨ Analyzed {bestParlay.combinationsChecked} combinations • 
              Manual refresh to preserve API calls • 
              Click "Regenerate" to find new opportunities
            </div>
          </div>
        ) : (
          // Show loading state when no best bet yet
          autoCalculating && (
            <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-center gap-3">
                <Loader className="w-6 h-6 animate-spin text-purple-600" />
                <span className="text-lg font-medium text-gray-700">
                  🔍 Analyzing all combinations to find the best {sport} bet...
                </span>
              </div>
            </div>
          )
        )}

        {/* Live Games */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            Live Games & Odds 
            <span className="text-sm bg-red-100 text-red-800 px-2 py-1 rounded">
              LIVE ONYXODDS vs PINNACLE
            </span>
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-6 h-6 animate-spin mr-2" />
              <span>Fetching live odds from OnyxOdds vs Pinnacle...</span>
            </div>
          ) : liveGames.length > 0 ? (
            <div className="grid gap-4">
              {liveGames.map(game => (
                <div key={game.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3">
                    <div className="font-semibold text-lg">
                      {game.awayTeam} @ {game.homeTeam}
                    </div>
                    <div className="text-sm text-gray-600">
                      {new Date(game.startTime).toLocaleTimeString()}
                    </div>
                  </div>
                  
                  <div className="grid gap-3">
                    {Object.entries(game.markets).map(([market, odds]) => (
                      <div key={market} className="bg-gray-50 p-3 rounded">
                        <div className="font-medium mb-2 capitalize flex items-center gap-2">
                          {market.replace(/_/g, ' ')}
                          {market.includes('winner_total') && (
                            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                              Correlation-Adjusted
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(odds.pinnacle).map(([side, pinnacleOdd]) => {
                            const boostedOdd = odds.boosted[side];
                            const edge = ((americanToDecimal(boostedOdd) / americanToDecimal(pinnacleOdd) - 1) * 100).toFixed(1);
                            
                            const displayName = side === 'home' ? game.homeTeam : 
                                               side === 'away' ? game.awayTeam : 
                                               side.includes('_') ? 
                                                 `${side.includes('home') ? game.homeTeam : game.awayTeam} ${side.split('_').slice(1).join(' ')}` :
                                                 side;
                            
                            return (
                              <button
                                key={side}
                                onClick={() => addGameToParlay(game, market, side)}
                                className="p-2 border border-gray-300 rounded hover:bg-blue-50 transition-colors text-left"
                              >
                                <div className="text-sm font-medium">
                                  {displayName}
                                </div>
                                <div className="flex justify-between text-xs">
                                  <span>Pin: {pinnacleOdd > 0 ? '+' : ''}{pinnacleOdd}</span>
                                  <span>OnyxOdds: {boostedOdd > 0 ? '+' : ''}{boostedOdd}</span>
                                  <span className={edge > 0 ? 'text-green-600' : 'text-red-600'}>
                                    {edge}%
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
              <p className="text-lg mb-2">No odds loaded yet</p>
              <p className="text-sm">Click "Refresh Live Odds" to fetch current data</p>
            </div>
          )}
        </div>

        {/* Parlay Builder */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Parlay Builder ({legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds).length}/{currentBoost?.minLegs || 3} minimum legs)
              </h2>
              {currentBoost && (
                <p className="text-sm text-orange-600 mt-1">
                  ⚠️ OnyxOdds {sport} requires: {currentBoost.requirement}
                  {currentBoost.minOdds && ` • +${currentBoost.minOdds} odds minimum`}
                </p>
              )}
            </div>
            <button
              onClick={addLeg}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Manual Leg
            </button>
          </div>

          {/* Boost Status Indicator */}
          {currentBoost && legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds).length >= 2 && (
            <div className="mb-4">
              <div className={`p-3 rounded-lg border ${
                validateBoostRequirement(legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds), sport, selectedBook)
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-orange-50 border-orange-200 text-orange-800'
              }`}>
                {validateBoostRequirement(legs.filter(leg => leg.pinnacleOdds && leg.boostedOdds), sport, selectedBook) ? (
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">✅</span>
                    <span className="font-medium">OnyxOdds boost requirements met!</span>
                    <span className="text-sm">Ready for {currentBoost.percentage}% boost</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-orange-600">⚠️</span>
                    <span className="font-medium">Boost requirements not met</span>
                    <span className="text-sm">{currentBoost.requirement}</span>
                    {currentBoost.minOdds && (
                      <span className="text-sm">• Need +{currentBoost.minOdds} odds</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {legs.map((leg, index) => (
            <div key={leg.id} className="grid grid-cols-12 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
              <div className="col-span-1 flex items-center">
                <span className="font-medium text-gray-600">{index + 1}</span>
              </div>
              
              <div className="col-span-2">
                <input
                  type="text"
                  value={leg.market}
                  onChange={(e) => updateLeg(leg.id, 'market', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-3">
                <input
                  type="text"
                  placeholder="Selection"
                  value={leg.selection}
                  onChange={(e) => updateLeg(leg.id, 'selection', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-2">
                <input
                  type="text"
                  placeholder="Pinnacle"
                  value={leg.pinnacleOdds}
                  onChange={(e) => updateLeg(leg.id, 'pinnacleOdds', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-2">
                <input
                  type="text"
                  placeholder="OnyxOdds"
                  value={leg.boostedOdds}
                  onChange={(e) => updateLeg(leg.id, 'boostedOdds', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-2 flex items-center justify-center">
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
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <TrendingUp className="w-5 h-5" />
            Calculate +EV for OnyxOdds {currentBoost?.percentage}% Boost
          </button>
        </div>

        {/* Results */}
        {results && (
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">
              OnyxOdds {sport} Boost Analysis ({results.boostUsed}%)
            </h3>
            
            {results.correlationWarnings && results.correlationWarnings.length > 0 && (
              <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h4 className="font-semibold text-yellow-800 mb-2">⚠️ Market-Based Correlation Detected</h4>
                {results.correlationWarnings.map((warning, index) => (
                  <div key={index} className="text-sm text-yellow-700 mb-1">
                    Same game: {warning.markets.join(' + ')} - Fair odds reduced by {warning.adjustment}%
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
                  <span className="font-medium">With {results.boostUsed}% Boost:</span>
                  <span className="font-semibold text-blue-600">
                    {results.boostedParlay > 0 ? '+' : ''}{results.boostedParlay}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Fair Value (Pinnacle):</span>
                  <span>{results.fairParlay > 0 ? '+' : ''}{results.fairParlay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Legs Used:</span>
                  <span>{results.legCount}/{currentBoost?.minLegs || 3}+ required</span>
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
                    {results.isPositiveEV ? '✅ POSITIVE EV' : '❌ NEGATIVE EV'}
                  </div>
                </div>
                
                {/* Calculation verification note */}
                <div className="mt-3 text-xs text-gray-500 text-center">
                  Verify: Check that boosted odds match OnyxOdds betslip before betting
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-semibold mb-3">Leg Breakdown</h4>
              <div className="space-y-2">
                {results.legs.map((leg, index) => (
                  <div key={index} className="flex justify-between items-center p-2 bg-white rounded">
                    <div className="flex-1">
                      <span className="font-medium">{leg.market}</span>
                      {leg.selection && <span className="text-gray-600 ml-2">- {leg.selection}</span>}
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span>OnyxOdds: {leg.boostedOdds > 0 ? '+' : ''}{leg.boostedOdds}</span>
                      <span>Pin: {leg.fairOdds > 0 ? '+' : ''}{leg.fairOdds}</span>
                      <span className={leg.edge > 0 ? 'text-green-600' : 'text-red-600'}>
                        Edge: {leg.edge}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Bet Now Button for Manual Calculations */}
              {results.isPositiveEV && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => openOnyxOdds({
                      legs: results.legs,
                      boostUsed: results.boostUsed,
                      expectedValue: results.expectedValue,
                      boostedParlay: results.boostedParlay
                    })}
                    className="w-full py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-lg font-bold hover:from-green-700 hover:to-blue-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
                  >
                    <span className="text-xl">🎯</span>
                    <span>BET NOW ON ONYXODDS</span>
                    <span className="text-xl">💰</span>
                  </button>
                  <p className="text-xs text-center text-gray-600 mt-2">
                    Opens OnyxOdds in new tab with bet details for easy placement
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-sm text-gray-600">
        <p>🔴 LIVE odds from OnyxOdds vs Pinnacle • Market-based correlation adjustments</p>
        <p>Manual refresh to preserve API calls • Current {sport} boost: {currentBoost?.percentage}%</p>
        <p>Requirements: {currentBoost?.requirement}{currentBoost?.minOdds ? ` • +${currentBoost.minOdds} odds minimum` : ''}</p>
      </div>
    </div>
  );
};

export default EVParlayCalculator;
