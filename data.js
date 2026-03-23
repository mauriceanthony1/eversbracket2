'use strict';

// ── 2026 NCAA Bracket ─────────────────────────────────────────
const BRACKET = {
  bracket: {
    EAST: [
      { id:'E1', seed1:1,  team1:'Duke',          seed2:16, team2:'Siena'           },
      { id:'E2', seed1:8,  team1:'Ohio State',     seed2:9,  team2:'TCU'             },
      { id:'E3', seed1:5,  team1:'St Johns',       seed2:12, team2:'Northern Iowa'   },
      { id:'E4', seed1:4,  team1:'Kansas',         seed2:13, team2:'Cal Baptist'     },
      { id:'E5', seed1:6,  team1:'Louisville',     seed2:11, team2:'South Florida'   },
      { id:'E6', seed1:3,  team1:'Michigan State', seed2:14, team2:'North Dakota State' },
      { id:'E7', seed1:7,  team1:'UCLA',           seed2:10, team2:'UCF'             },
      { id:'E8', seed1:2,  team1:'UConn',          seed2:15, team2:'Furman'          },
    ],
    WEST: [
      { id:'W1', seed1:1,  team1:'Arizona',        seed2:16, team2:'LIU'             },
      { id:'W2', seed1:8,  team1:'Villanova',      seed2:9,  team2:'Utah State'      },
      { id:'W3', seed1:5,  team1:'Wisconsin',      seed2:12, team2:'High Point'      },
      { id:'W4', seed1:4,  team1:'Arkansas',       seed2:13, team2:'Hawaii'          },
      { id:'W5', seed1:6,  team1:'BYU',            seed2:11, team2:'Texas'           },
      { id:'W6', seed1:3,  team1:'Gonzaga',        seed2:14, team2:'Kennesaw State'  },
      { id:'W7', seed1:7,  team1:'Miami FL',       seed2:10, team2:'Missouri'        },
      { id:'W8', seed1:2,  team1:'Purdue',         seed2:15, team2:'Queens'          },
    ],
    SOUTH: [
      { id:'S1', seed1:1,  team1:'Florida',        seed2:16, team2:'Prairie View'    },
      { id:'S2', seed1:8,  team1:'Clemson',        seed2:9,  team2:'Iowa'            },
      { id:'S3', seed1:5,  team1:'Texas Tech',     seed2:12, team2:'Akron'           },
      { id:'S4', seed1:4,  team1:'Alabama',        seed2:13, team2:'Hofstra'         },
      { id:'S5', seed1:6,  team1:'Tennessee',      seed2:11, team2:'VCU'             },
      { id:'S6', seed1:3,  team1:'Virginia',       seed2:14, team2:'Wright State'    },
      { id:'S7', seed1:7,  team1:'Saint Marys',    seed2:10, team2:'NC State'        },
      { id:'S8', seed1:2,  team1:'Houston',        seed2:15, team2:'Idaho'           },
    ],
    MIDWEST: [
      { id:'M1', seed1:1,  team1:'Michigan',       seed2:16, team2:'Howard'          },
      { id:'M2', seed1:8,  team1:'Georgia',        seed2:9,  team2:'Saint Louis'     },
      { id:'M3', seed1:5,  team1:'Nebraska',       seed2:12, team2:'Troy'            },
      { id:'M4', seed1:4,  team1:'Iowa State',     seed2:13, team2:'Lehigh'          },
      { id:'M5', seed1:6,  team1:'SMU',            seed2:11, team2:'Miami OH'        },
      { id:'M6', seed1:3,  team1:'Kentucky',       seed2:14, team2:'Montana State'   },
      { id:'M7', seed1:7,  team1:'Ohio State',     seed2:10, team2:'Santa Clara'     },
      { id:'M8', seed1:2,  team1:'Illinois',       seed2:15, team2:'Tennessee State' },
    ],
  },
};

// ── Users ─────────────────────────────────────────────────────
const USERS = ['PME', 'Phil', 'Reece'];

// ── Scoring ───────────────────────────────────────────────────
const SCORING = { R64:1, R32:2, S16:4, E8:8, F4:16, CHIP:32 };

// ── Rounds ────────────────────────────────────────────────────
const ROUNDS = ['R64', 'R32', 'S16', 'E8', 'F4', 'CHIP'];

// ── Recovered picks (seed backup — seeded into Supabase on first boot) ──
const SEED_PICKS = {
  PME: {
    R64:  ['Duke','TCU','St Johns','Kansas','Louisville','Michigan State','UCLA','UConn',
           'Arizona','Utah State','High Point','Arkansas','Texas','Gonzaga','Miami FL','Purdue',
           'Florida','Iowa','Texas Tech','Alabama','Tennessee','Virginia','NC State','Houston',
           'Michigan','Saint Louis','Nebraska','Iowa State','SMU','Kentucky','Santa Clara','Illinois'],
    R32:  ['Duke','St Johns','Michigan State','UConn',
           'Arizona','Arkansas','Texas','Purdue',
           'Iowa','Alabama','Virginia','Houston',
           'Michigan','Nebraska','Kentucky','Illinois'],
    S16:  ['Duke','Michigan State','Arizona','Texas','Alabama','Houston','Michigan','Illinois'],
    E8:   ['Duke','Arizona','Houston','Michigan'],
    F4:   ['Arizona','Houston'],
    CHIP: ['Houston'],
  },
  Phil: {
    R64:  ['Duke','TCU','St Johns','Kansas','Louisville','Michigan State','UCF','UConn',
           'Arizona','Villanova','High Point','Arkansas','Texas','Gonzaga','Miami FL','Purdue',
           'Florida','Clemson','Texas Tech','Alabama','VCU','Virginia','NC State','Houston',
           'Michigan','Saint Louis','Nebraska','Iowa State','SMU','Kentucky','Ohio State','Illinois'],
    R32:  ['TCU','St Johns','Louisville','UConn',
           'Arizona','High Point','Gonzaga','Purdue',
           'Florida','Alabama','VCU','Houston',
           'Michigan','Nebraska','Kentucky','Illinois'],
    S16:  ['St Johns','UConn','High Point','Gonzaga','Alabama','Houston','Michigan','Illinois'],
    E8:   ['St Johns','Gonzaga','Houston','Michigan'],
    F4:   [],
    CHIP: [],
  },
  Reece: {
    R64:  ['Duke','Ohio State','St Johns','Kansas','Louisville','Michigan State','UCLA','UConn',
           'Arizona','Utah State','Wisconsin','Arkansas','BYU','Gonzaga','Miami FL','Purdue',
           'Florida','Iowa','Akron','Alabama','Tennessee','Virginia','Saint Marys','Houston',
           'Michigan','Saint Louis','Nebraska','Iowa State','SMU','Kentucky','Ohio State','Illinois'],
    R32:  ['Duke','St Johns','Michigan State','UConn',
           'Arizona','Arkansas','BYU','Purdue',
           'Florida','Alabama','Tennessee','Houston',
           'Michigan','Nebraska','SMU','Illinois'],
    S16:  ['St Johns','UConn','Arizona','Purdue','Florida','Houston','Michigan','Illinois'],
    E8:   ['St Johns','Arizona','Houston','Michigan'],
    F4:   ['Arizona','Houston'],
    CHIP: ['Houston'],
  },
};

module.exports = { BRACKET, SEED_PICKS, SCORING, USERS, ROUNDS };
