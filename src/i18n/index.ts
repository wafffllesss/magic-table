import { createI18n } from 'vue-i18n';
import { ref } from 'vue';
import type { GameLogEvent } from '../domain/game';

export type LanguagePreference = 'auto' | 'en' | 'pt-BR';
export type AppLocale = Exclude<LanguagePreference, 'auto'>;
export let initialPreference: LanguagePreference = 'auto';
const localeRevision = ref(0);

export function useAppI18n() {
  const t = ((...args: unknown[]) => {
    void localeRevision.value;
    return (i18n.global.t as (...values: any[]) => string)(...args);
  }) as typeof i18n.global.t;
  return { t, locale: i18n.global.locale };
}

export function detectLocale(languages: readonly string[] | undefined): AppLocale {
  for (const language of languages ?? []) {
    const normalized = language.trim().replaceAll('_', '-').toLowerCase();
    if (normalized.startsWith('pt-') || normalized === 'pt') return 'pt-BR';
    if (normalized.startsWith('en-') || normalized === 'en') return 'en';
  }
  return 'en';
}

export function normalizePreference(value: unknown): LanguagePreference {
  return value === 'en' || value === 'pt-BR' || value === 'auto' ? value : 'auto';
}

export function resolveLocale(preference: LanguagePreference, languages: readonly string[] | undefined): AppLocale {
  return preference === 'auto' ? detectLocale(languages) : preference;
}

const messages = {
  en: {
    notifications: { enable: 'Enable notifications', joined: '{name} joined the room.', disconnected: '{name} disconnected.', reconnected: '{name} reconnected.', started: 'The game has started.', turn: 'It is your turn.', priority: 'You have priority.' },
    startup: { cards: 'Preparing your decks…', images: 'Preparing card images…', progress: 'Startup progress', incomplete: 'Some cards or images could not be prepared. You can continue and try again later.', update: 'An update is available', versions: 'Current version: {current} · New version: {latest}', download: 'Download update', skip: 'Continue without waiting' },
    tutorial: { title: 'Welcome to the table', step: 'Step {current} of {total}', close: 'Close tutorial', previous: 'Back', next: 'Next', finish: 'Finish', hide: 'Don’t show again', reopen: 'View tutorial', shortcuts: 'View shortcuts', lookTitle: 'Look around', look: 'Move the mouse across the table to look around.', tableZoomTitle: 'Zoom the table', tableZoom: 'Scroll over the table to zoom in or out.', cardZoomTitle: 'Inspect a card', cardZoom: 'Scroll up over a card to enlarge it; scroll down to close it.', menuTitle: 'Open options', menu: 'Right-click a card or another table element to see its options.', tapTitle: 'Tap a card', tap: 'On a card you control, middle-click, double-click, or hover and press T to tap or untap it.', targetTitle: 'Choose a target', target: 'Hold Alt and click to highlight a target, or drag from a card to a target.', keysTitle: 'Explore shortcuts', keys: 'Use the shortcuts list for more commands. Open it anytime with ?.' },
    language: { label: 'Language', auto: 'Automatic', english: 'English', portuguese: 'Português', selector: 'Choose interface language' },
    meta: { title: 'My Magic · Online Commander', description: 'A shared table for playing Commander online.' },
    common: {
      cancel: 'Cancel', back: 'Back', close: 'Close', continue: 'Continue', save: 'Save', loading: 'Loading…',
      retry: 'Try again', cards: 'cards | {count} card | {count} cards',
    },
    app: {
      name: 'My Magic', connected: 'CONNECTED', reconnecting: 'RECONNECTING', leaveRoom: 'Leave room', directP2p: 'Direct connection', firebaseRelay: 'Firebase relay', mixedTransport: 'P2P + Firebase',
      storageWarning: 'Local storage is unavailable. This session will stay in memory and will not be saved when you close the app.',
      genericError: 'The action could not be completed.',
      playerName: 'Your name', playerNamePlaceholder: 'Your name at the table', nameContinue: 'Continue',
      nameInvalid: 'Choose a name with at least two letters.',
      nameInputLabel: 'Your name at the table',
      editName: 'Edit name',
      joinedAsPlayer: 'You joined table {code}. Confirm when you are ready.', joinedAsSpectator: 'You joined table {code} as a spectator and joined the queue.',
      deckReady: 'Deck ready. Confirm your seat to start the game.', deckQueued: 'Deck saved locally. You will join with this list when a seat opens.',
      playmatApplied: 'Playmat applied to your area.', playmatReset: 'Green felt restored.', offerAccepted: 'You accepted the open seat.', offerDeclined: 'You declined the offer.',
      agentTitle: 'Create agent', agentInstructions: 'Copy this prompt and paste it into your AI so it can create your agent. Then start a new conversation, invoke the agent and play.', agentPromptLabel: 'PROMPT FOR YOUR AI', agentCopy: 'Copy prompt', agentCopied: 'Prompt copied.', agentCopyFailed: 'Could not copy the prompt.',
      mcpCopied: 'MCP address copied.', mcpCopyFailed: 'Could not copy the MCP address.', mcpCopy: 'Copy address',
      mcpActive: 'LOCAL MCP SERVER ACTIVE', mcpUnavailable: 'MCP SERVER UNAVAILABLE', mcpInstructions: 'Connect an MCP client on this computer, then use the table code to join each AI.', mcpStartError: 'The local MCP server could not start.',
    },
    chat: { open: 'Chat', compose: 'Say something', placeholder: 'Message to the table…', message: 'Message', emoji: 'Choose emoji', characters: '{count} of {limit} characters', send: 'Send', shortcut: 'Open chat' },
    rooms: {
      title: 'Games', create: 'Create table', joinCode: 'Join with code', createJoin: 'Create table and join',
      roomName: 'Table name', password: 'Password (optional)', passwordIfAny: 'Password, if set', code: 'Table code',
      enter: 'Join table', watch: 'Watch', entering: 'Connecting…', demo: 'Local demo', demoHint: 'Local · Test your deck',
      play: 'Play', preparing: 'Preparing…', searching: 'Looking for tables…', empty: 'No open online tables.',
      more: 'Load more tables', loadingMore: 'Loading…', unavailable: 'Online tables are unavailable on this device.',
      network: 'No connection to the table service. Check your internet connection and try again.',
      genericError: 'Could not access the tables.', passwordError: 'Incorrect password. Check the code and try again.',
      protected: 'Password protected', lobby: 'Waiting for players', playing: 'In progress',
      players: '{count}/4 players', people: '{count}/12 people',
      passwordNote: 'This password is a simple barrier and can be bypassed by modified clients.',
    },
    lobby: {
      inviteCode: 'TABLE CODE', copyCode: 'Copy code', codeCopied: 'Table code copied.', codeCopyFailed: 'Could not copy the table code.',
      heading: 'The table is getting ready.', subheading: 'Your seat is waiting.',
      chooseDeckDescription: 'Choose a Commander deck and confirm when you are ready.',
      watching: 'You are watching.', waitingPosition: 'Your queue position is {position}.',
      emptySeat: 'A seat will open when the game ends.', beforeTurn: 'BEFORE THE FIRST TURN', watchRoom: 'WATCH THE ROOM',
      prepareSeat: 'Prepare your seat.', followTable: 'Follow the table.',
      readyDescription: 'Choose your deck and confirm your seat. The game starts when everyone at the table is ready.',
      queueDescription: 'Prepare your deck while you wait. You will receive an invitation when a seat opens.',
      greeting: 'Hello, {name}', waitingQueue: 'You are in the waiting queue',
      deckReady: 'Deck selected · ready to review', chooseDeckPrompt: 'Choose a deck to prepare your seat',
      queueWatching: 'Position {position} · you can still see the table', offerWaiting: 'You will receive an offer when someone leaves',
      changeDeck: 'Change deck', chooseDeck: 'Choose a deck', prepareDeck: 'Prepare a deck',
      ready: '✓ Ready', confirmSeat: 'Confirm my seat',
      offerTitle: 'A seat is open.', offerIntro: '{candidate} left {seat}. If you accept, you inherit that seat’s hand, deck, and permanents.',
      offerTimer: 'SECONDS TO RESPOND', decline: 'Decline offer', accept: 'Accept seat', entering: 'Joining…',
      offerNote: 'If you decline, your queue position stays the same for the next opening.',
    },
    lobbyBoard: {
      overview: 'TABLE OVERVIEW', ready: 'READY', seat: 'SEAT', you: 'YOU', available: 'Seat available',
      choosingDeck: 'Choosing a deck', reconnecting: 'RECONNECTING', waitingPlayer: 'Waiting for player',
      playersAtTable: 'PLAYERS AT THE TABLE', inQueue: 'IN QUEUE', yourSeat: 'YOUR SEAT', footer: '40 LIFE · 100 CARDS · COMMANDER',
      playerReady: 'READY', online: 'ONLINE',
    },
    inspection: { label: 'Inspect {card}', close: 'Close card inspection', unavailable: 'This card’s text is unavailable.', deckQuantity: 'DECK QUANTITY · {count}', escapeClose: 'ESC TO CLOSE' },
    cardTypes: { creature: 'Creatures', planeswalker: 'Planeswalkers', instant: 'Instants', sorcery: 'Sorceries', artifact: 'Artifacts', enchantment: 'Enchantments', battle: 'Battles', land: 'Lands', other: 'Other', commander: 'Commanders' },
    colors: { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' },
    deck: {
      library: 'YOUR LIBRARY', decks: 'Decks', new: 'New deck', localData: 'Cards and images load on demand', empty: 'No saved decks. Start with a ready-made list or import your own.',
      partnerSummary: 'PARTNER · 100 CARDS', commanderSummary: 'COMMANDER · 100 CARDS', chooseBackground: 'CHOOSE A BACKGROUND', defaultName: 'My Commander deck',
      synced: 'Synced with the table', storedLocally: 'Your decks stay on this computer', cancel: 'Cancel', backToTable: 'Back to table',
      backToLibrary: 'Back to library', officialPrecon: 'OFFICIAL PRECON', inspectDeck: 'DECK INSPECTION', noCommander: 'No commander selected',
      copies: '{count} copies', inspectCard: 'Inspect {card}', updating: 'Updating card data…', refreshProgress: '{loaded} of {total} cards loaded · {remaining} remaining', refreshCards: 'Refresh card data', savedDeckKept: 'The saved deck was kept.', removeSaved: 'Remove saved deck', officialSource: 'OFFICIAL SOURCE', progressEstimate: 'estimate',
      ready: 'Ready', import: 'Import', create: 'Build a deck', format: 'COMMANDER', chooseDeck: 'Choose your deck', loading: 'Loading…', loadMore: 'Load more decks',
      checkingCards: 'Checking cards with Scryfall…', emptyLibrary: 'Your library is empty.', firstVisit: 'On your first visit, we load Commander lists and save their card data on this computer.',
      loadCards: 'Loading cards', loadPrecons: 'Load {count} precons', cached: 'Card data is cached; images load as you browse.', colorFilter: 'Filter decks by color identity', colors: 'COLORS', deckCount: '{shown} of {total} decks', clearFilter: 'Clear filter',
      noColorDecks: 'No decks with these colors.', clearOrChoose: 'Clear the filter or choose another combination.', choose: 'Choose', details: 'Details',
      inspectCards: 'Inspect cards', export: 'Export .txt', syncing: 'Syncing…', useDeck: 'Use this deck', savedWith: '{name} saved with {count} cards.',
      importTitle: 'Your deck is ready.', importHint: 'Paste your deck as text, with commanders in a separate section.', acceptedFormat: 'ACCEPTED FORMAT',
      importFormatHelp: 'Repeat the leader line to add a second commander. The total must be 100.', importSavedWhileOpen: 'Your text stays saved while this editor is open.', checking: 'Checking…', checkList: 'Check list only', fetchingCards: 'Finding cards…', saveAndCheck: 'Save and check',
      builder: 'COMMANDER DECK BUILDER', buildFromCard: 'Start with a card.', builderHelp: 'Search Scryfall and add cards to your deck. Exceptions stay visible.', deckName: 'DECK NAME',
      searchCards: 'SEARCH CARDS', searchPlaceholder: 'Name, card, or ability…', searching: 'Searching…', search: 'Search', searchHelp: 'Searches Commander legal cards. Found metadata is cached locally.', colorless: 'Colorless', banned: 'BANNED',
      commanderOne: 'COMMANDER 1', commanderTwo: 'COMMANDER 2', identity: 'Identity: {colors}', partnershipCheck: 'Partnership is checked against card text and type.', remove: 'Remove', addBasics: '＋ Add 35 basic lands by identity', inDeck: 'IN YOUR DECK', cardCount: '{count} cards', removeCopy: 'Remove one copy', addCopy: 'Add one copy', noCardsYet: 'No cards in the deck yet. Search for your commander to begin.', validateSave: 'Validate and save', validating: 'Validating…', deckNeedsChanges: 'Your deck needs changes',
      deckUpdated: 'Card data updated. The deck composition was kept.', basicsAdded: '35 basic lands were added. Fill out the other cards to reach 100.',
      precombat: 'OFFICIAL PRECON', deckColors: 'COLOR IDENTITY', basicLands: 'BASIC LANDS', officialCardsScryfall: 'OFFICIAL CARDS · SCRYFALL',
      nextTurn: 'Your next turn starts here.', chooseList: 'Choose a list to see its color distribution and commander details.',
      possibilities: 'One table.<br>Many possibilities.', deckRules: 'Commander decks have 100 cards including commanders. Basic lands may repeat; check color identity and legality.',
      commandersCount: 'commanders', totalCards: 'cards total', bannedCards: 'banned cards',
      pasteList: 'Paste your list.<br>The table checks it.', fileHelp: 'We resolve printings, check Commander restrictions, and keep your list in the local cache.', quantityName: '.TXT · QUANTITY + NAME',
      footerSaved: 'DECKS SAVED ON THIS DEVICE', footerSync: 'TABLE LIST SHARED WHEN YOU CONFIRM', close: 'CLOSE',
      cardsGrouped: 'Deck cards grouped by type', reviewBeforePlay: 'Review these points before playing', missingCards: 'Cards not found on Scryfall: {names}', deckSource: 'Deck source',
      commander: 'COMMANDER', commanders: 'COMMANDERS', commanderPair: 'COMMANDER PARTNERS', commanderTax: 'CASTING TAX · INDIVIDUAL', commandZone: 'COMMAND ZONE',
      cardsWord: 'cards', noSearchMatch: 'No cards found for this search term.', recognized: 'Deck recognized. {count} cards, ready to save.',
      yourList: 'YOUR LIST', chooseNamed: 'Choose {name}', detailsNamed: 'Details for {name}', personalList: 'PERSONAL LIST', leader: 'LEADER',
      setPrimaryCommander: 'Set as primary commander', setSecondaryCommander: 'Set as second commander', add: 'Add',
      tablePreview: 'TABLE PREVIEW', tableForFour: 'TABLE FOR FOUR', deckDraft: 'DECK DRAFT', yourFile: 'YOUR FILE', officialDataOnDemand: 'data and images on demand',
      nextTurn1: 'Your next turn', nextTurn2: 'starts here.', possibilities1: 'One table.', possibilities2: 'Many possibilities.', pasteList1: 'Paste your list.', pasteList2: 'The table checks it.',
    },
      table: {
      step: 'Step', phase: 'Phase', untap: 'Untap', upkeep: 'Upkeep', drawStep: 'Draw',
      precombatMain: 'Precombat main', combat: 'Combat', postcombatMain: 'Postcombat main', end: 'End',
      paused: 'Game paused', finished: 'Game over', preparingHand: 'Preparing hand', eliminated: 'Player eliminated',
      yourTurn: 'Your turn', waitingTurn: 'Waiting for your turn',
      nextStep: 'Next step', previousStep: 'Previous step', phaseNavigation: 'Turn phase navigation', emptySeat: 'Empty', endTurn: 'End turn', history: 'History', closeHistory: 'Close history',
      leave: 'LEAVE TABLE', you: 'YOU', out: 'OUT', draw: 'Draw', search: 'Search', shuffle: 'Shuffle',
      gameTable: 'Game table', appVersion: 'Version {version}', updateApp: 'Update your app', actionHistory: 'Action history', recentActions: 'Recent actions', openActionLog: 'Open full action log. {count} recent events.', online: 'Online', offline: 'Offline', turnSteps: 'Steps of the turn',
      overview: 'Overview', ownSeat: 'My seat', settings: 'Settings', settingsSections: 'Settings sections', settingsTableTab: 'Table', disableCustomPlaymats: 'Disable all custom playmats', disableCustomPlaymatsDescription: 'Hide custom playmat artwork on your screen only.', personalizePlaymat: 'Customize playmat', shortcuts: 'Shortcuts',
      card: 'Card', faceDownCard: 'Face-down card', hand: 'Your hand: {count} cards',
      liveRoom: 'LIVE ROOM', localDemo: 'LOCAL DEMO', round: 'ROUND {count}', pausedDescription: 'Waiting for {name} to reconnect.', continueWithout: 'Continue without {name}', suspended: 'Suspended', synced: 'SYNCED STATE',
      life: 'LIFE', stepsHeading: 'TURN STEPS', currentTurn: 'CURRENT TURN', waiting: 'WAITING', eliminatedStatus: 'ELIMINATED',
      waitingPlayer: 'WAITING FOR PLAYER', invitePlayer: 'Invite someone to the table', gameZone: 'PLAY AREA',
      poison: 'POISON', commander: 'COMMANDER', commanderDamage: 'COMMANDER DAMAGE', eliminationAt: '21 = ELIMINATION',
      mulligan: 'MULLIGAN {count} · CHOOSE UP TO {cards} CARDS', keepHand: 'Keep hand',
      stack: 'STACK', resolved: 'RESOLVED', readyResolve: 'READY TO RESOLVE', nextResponse: 'NEXT RESPONSE', turnPlayer: 'TURN PLAYER',
      noPending: 'No responses pending', youPassed: 'YOU PASSED', passPriority: 'PASS PRIORITY', waitingCast: 'WAITING FOR A SPELL', revealedCards: 'REVEALED CARDS',
      emptyZone: 'This zone is empty.', libraryActions: 'Library actions', generalActions: 'General actions',
      createToken: 'Create token', resolveStack: 'Resolve the top of the stack', historyActions: 'Action history', concede: 'Concede the game',
      tokenLibraryEyebrow: 'CREATURE TOKEN LIBRARY', tokenLibraryTitle: 'Choose a creature token.', tokenLibraryDescription: 'Choose a token to put it directly onto the battlefield.', tokenSearchLabel: 'SEARCH TOKENS', tokenSearchPlaceholder: 'Token name or creature type', onlyDeckTokens: 'Only tokens from this deck', noDeckTokens: 'No creature tokens from this deck are available.', tokenGroups: 'Creature tokens grouped by type', tokenCount: 'tokens', tokenLoading: 'Loading creature tokens…', noTokenResults: 'No creature tokens found for this search.', noTokens: 'No creature tokens are available.', loadMoreTokens: 'Load more tokens', createNamedToken: 'Create {card}',
      drawCard: 'Draw a card', searchLibrary: 'Search library', shuffleLibrary: 'Shuffle library',
      yourPlaymatControls: 'Controls beside your playmat', commanderDamageLabel: 'Commander damage',
      tableShortcuts: 'Keyboard shortcuts', buyShortcut: 'DRAW', tapShortcut: 'TAP', undoShortcut: 'UNDO', redoShortcut: 'REDO', targetShortLabel: 'TARGET', middleMouse: 'MIDDLE MOUSE', doubleClick: 'DOUBLE CLICK', rightMouse: 'RIGHT MOUSE', tapMouse: 'Tap / untap a card you control', scrollHelp: 'Zoom the table or inspect a card', contextHelp: 'Open the options menu',
      playmatDialog: 'Customize playmat', playmatEyebrow: 'YOUR SPACE AT THE TABLE', choosePlaymat: 'Choose your playmat.', applyPlaymat: 'Apply playmat',
      greenFelt: 'Green felt', officialMagicArt: 'Official Magic: The Gathering art', noActions: 'No actions have been recorded yet.',
      searchDialog: 'PRIVATE SEARCH · ONLY YOUR LIBRARY', findCard: 'Find a card.', privateSearchDescription: 'Chosen names do not appear in the public history. Your library will be shuffled when you finish.',
      searchLabel: 'SEARCH YOUR LIBRARY', searchPlaceholder: 'Name, type, or Oracle text', groupedCards: 'Library cards grouped by type',
      noSearchResults: 'No cards found for this search.', emptyLibrary: 'Your library is empty.', destination: 'DESTINATION',
      yourHand: 'Your hand', battlefield: 'Battlefield', selectedCards: 'card(s) selected', maxSearchCards: 'Choose up to 20 cards per search.',
      finishSearch: 'Finish and shuffle', commanderControls: 'COMMANDER TABLE · CONTROLS', playYourWay: 'Play your way.',
      helpIntro: 'The table tracks common states and actions. Card effects, targets, and combat are still decided by the players.',
      drawOne: 'Draw one card', undoAction: 'Undo last action', redoAction: 'Redo action', tapSelected: 'Tap / untap the card under the pointer, or the selected card',
      flipSelected: 'Flip selected card', selectMove: 'Select or move permanents', lookAround: 'Look around your seat',
      touchPan: 'Drag the background to look around on touch screens', cancelSelection: 'Cancel selection', understood: 'Got it',
      action: 'Action', stackAction: 'SPELL', abilityAction: 'ABILITY', passKey: 'PASSED',
      searchNameLabel: 'Name, type, or Oracle text', revealedBy: 'Revealed by',
      minuteTime: '{time}', scrollCardsEnd: 'Scroll cards to the end',
      tapped: 'tapped', untapped: 'untapped',
      opponentHand: "{name}'s hand: {count} card | {name}'s hand: {count} cards", inHand: 'in hand',
      libraryOf: "{name}'s library · {count} card | {name}'s library · {count} cards",
      confirmConcede: 'Concede the game? Your seat will be marked as eliminated and the table will continue.', confirmTransferControl: 'Pass control of this card to {name}?', passControl: 'Pass control',
      commanderZoneQuestion: 'Send {name} to the command zone? If you decline, it will go to the chosen destination.', sendToCommand: 'Send to command zone', keepDestination: 'Keep chosen destination',
      targetAnnounceHighlight: '{author} highlighted {target}.', targetAnnounceArrow: '{author} targeted {target} with {origin}.', targetSelect: 'Select this target', targetFrom: 'Target with this card', targetChoose: 'Select a target', targetShortcut: 'Highlight or drag to target',
      menuPrivateLibrary: 'Private library', buyCard: 'Draw a card', searchLibraryMenu: 'Search library', shuffleLibraryMenu: 'Shuffle library',
      menuInspect: 'Inspect', menuPlay: 'Play land', menuCast: 'Cast', menuReveal: 'Reveal this card', menuDiscard: 'Discard to graveyard', menuTap: 'Untap', menuUntap: 'Tap', menuFlip: 'Transform', menuFaceDown: 'Turn face down', menuRevealFaceDown: 'Reveal this card', menuCounter: '+1/+1 counter', menuGraveyard: 'Move to graveyard', menuExile: 'Exile', menuHand: 'Return to hand',
      graveyard: 'Graveyard', exile: 'Exile', graveyardOf: 'Graveyard of {name} · {count} card | Graveyard of {name} · {count} cards', exileOf: 'Exile of {name} · {count} card | Exile of {name} · {count} cards', scrollCardsStart: 'Scroll cards to the beginning', copies: '{count} copies',
      zoneEmpty: 'This zone is empty.', handCount: 'IN HAND', openZoneAside: 'Open {zone} to the side', searchZone: 'Search {zone}', searchLabelPublic: 'SEARCH THIS ZONE', cardsCount: 'cards', zoneFanPrevious: 'Show previous card', zoneFanNext: 'Show next card', zoneFanStackPrevious: '{count} previous cards; show one', zoneFanStackNext: '{count} next cards; show one',
      lifeOf: "Life for {name}", decreaseLife: "Decrease {name}'s life", increaseLife: "Increase {name}'s life", commanderLabel: 'Commander: {name}',
      reduceCommanderDamage: 'Reduce damage received from {commander} by {player}', increaseCommanderDamage: 'Increase damage received from {commander} by {player}', damageReceived: 'Damage received from {commander} by {player}',
      mulliganAction: 'Mulligan', handCard: 'Card in hand',
      steps: { 'Desvirar': 'Untap', 'Manutenção': 'Upkeep', 'Compra': 'Draw', 'Principal pré-combate': 'Precombat main', 'Combate': 'Combat', 'Principal pós-combate': 'Postcombat main', 'Final': 'End' },
      zones: { library: 'Library', hand: 'Hand', battlefield: 'Battlefield', graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone', stack: 'Stack' },
    },
    gameLog: {
      draw: '{actor} drew one card. | {actor} drew {count} cards.', mulligan: '{actor} took a mulligan ({count}).', keep: '{actor} kept their hand.',
      playLand: '{actor} played {card}.', move: '{actor} moved {card} to {zone}.', tap: '{actor} {verb} {card}.',
      life: '{actor} changed {player}’s life by {amount}.', counter: '{actor} changed {counter} by {amount} on {target}.',
      commanderDamage: '{actor} dealt {amount} commander damage to {player}.', cast: '{actor} cast {card}.',
      ability: '{actor} activated an ability of {card}.', pass: '{actor} passed priority.', resolve: '{actor} resolved {card}.',
      phase: '{actor}: {step}.', endTurn: '{actor} ended the turn. It is {player}’s turn.', shuffle: '{actor} shuffled their library.',
      concede: '{actor} conceded the game.', token: '{actor} created token {card}.',
      reveal: '{actor} revealed {cards}.', search: '{actor} searched their library and chose {count} card(s).',
      transfer: '{actor} transferred control of {card} to {player}.', flipFace: '{actor} turned {card} to its other face.',
      faceDown: '{actor} turned a card face down.', revealFaceDown: '{actor} turned a face-down card face up.', reposition: '{actor} repositioned {card}.',
      undo: 'Undid: {source}', redo: 'Redid: {source}',
    },
    errors: {
      unknown: 'Something went wrong. Please try again.', firebaseNetwork: 'Could not connect to Firebase. Check your connection.',
      firebaseConfig: 'Enable Authentication and the Anonymous provider in the Firebase console to connect players.',
      scryfallNetwork: 'Could not connect to Scryfall. Check your connection.',
      scryfallUnavailable: 'Scryfall is temporarily unavailable. Please try again.',
      network: 'The connection failed. Check your internet connection and try again.', actionRejected: 'This action was rejected by the table.', actionPending: 'The previous action is still syncing. Please wait.',
      deckSync: 'Could not sync the deck.', directoryUnavailable: 'The room directory is unavailable.',
    },
  },
  'pt-BR': {
    notifications: { enable: 'Ativar notificações', joined: '{name} entrou na sala.', disconnected: '{name} desconectou.', reconnected: '{name} reconectou.', started: 'O jogo começou.', turn: 'É a sua vez de jogar.', priority: 'A prioridade é sua.' },
    startup: { cards: 'Preparando seus decks…', images: 'Preparando imagens das cartas…', progress: 'Progresso da inicialização', incomplete: 'Não foi possível preparar algumas cartas ou imagens. Você pode continuar e tentar novamente mais tarde.', update: 'Uma atualização está disponível', versions: 'Versão atual: {current} · Nova versão: {latest}', download: 'Baixar atualização', skip: 'Continuar sem esperar' },
    tutorial: { title: 'Boas-vindas à mesa', step: 'Etapa {current} de {total}', close: 'Fechar tutorial', previous: 'Voltar', next: 'Próximo', finish: 'Concluir', hide: 'Não exibir novamente', reopen: 'Ver tutorial', shortcuts: 'Ver atalhos', lookTitle: 'Olhe ao redor', look: 'Mova o mouse sobre a mesa para controlar a visão.', tableZoomTitle: 'Aproxime a mesa', tableZoom: 'Use o scroll sobre a mesa para aproximar ou afastar a visão.', cardZoomTitle: 'Inspecione uma carta', cardZoom: 'Use o scroll para cima sobre uma carta para ampliá-la; role para baixo para fechar.', menuTitle: 'Abra as opções', menu: 'Clique com o botão direito em uma carta ou outro elemento da mesa para ver suas opções.', tapTitle: 'Vire uma carta', tap: 'Em uma carta que você controla, use o botão do meio, clique duas vezes ou passe o mouse e pressione T para virar ou desvirar.', targetTitle: 'Escolha um alvo', target: 'Segure Alt e clique para destacar um alvo, ou arraste de uma carta até o alvo.', keysTitle: 'Explore os atalhos', keys: 'Consulte a lista para conhecer outros comandos. Abra-a a qualquer momento com ?.' },
    language: { label: 'Idioma', auto: 'Automático', english: 'English', portuguese: 'Português', selector: 'Escolher idioma da interface' },
    meta: { title: 'Meu Magic · Commander online', description: 'Uma mesa compartilhada para jogar Commander online.' },
    common: {
      cancel: 'Cancelar', back: 'Voltar', close: 'Fechar', continue: 'Continuar', save: 'Salvar', loading: 'Carregando…',
      retry: 'Tentar novamente', cards: 'cartas | {count} carta | {count} cartas',
    },
    app: {
      name: 'Meu Magic', connected: 'CONECTADO', reconnecting: 'RECONECTANDO', leaveRoom: 'Sair da sala', directP2p: 'Conexão direta', firebaseRelay: 'Via Firebase', mixedTransport: 'P2P + Firebase',
      storageWarning: 'Armazenamento local indisponível. Os dados desta sessão ficarão somente em memória e não serão salvos ao fechar.',
      genericError: 'Não foi possível concluir a ação.',
      playerName: 'Seu nome', playerNamePlaceholder: 'Seu nome na mesa', nameContinue: 'Continuar',
      nameInvalid: 'Escolha um nome com pelo menos duas letras.', nameInputLabel: 'Seu nome na mesa', editName: 'Alterar nome',
      joinedAsPlayer: 'Você entrou na mesa {code}. Confirme quando estiver pronto.', joinedAsSpectator: 'Você entrou na mesa {code} como espectador e está na fila.',
      deckReady: 'Deck pronto. Confirme seu lugar para iniciar a partida.', deckQueued: 'Deck salvo localmente. Você entrará com esta lista quando uma vaga abrir.',
      playmatApplied: 'Playmat aplicado à sua área.', playmatReset: 'Feltro verde restaurado.', offerAccepted: 'Você aceitou a vaga aberta.', offerDeclined: 'A oferta foi recusada.',
      agentTitle: 'Criar agente', agentInstructions: 'Copie este prompt e cole na sua IA para que ela crie seu agente. Depois, inicie outra conversa, invoque o agente e comece a jogar.', agentPromptLabel: 'PROMPT PARA SUA IA', agentCopy: 'Copiar prompt', agentCopied: 'Prompt copiado.', agentCopyFailed: 'Não foi possível copiar o prompt.',
      mcpCopied: 'Endereço MCP copiado.', mcpCopyFailed: 'Não foi possível copiar o endereço MCP.', mcpCopy: 'Copiar endereço',
      mcpActive: 'SERVIDOR MCP LOCAL ATIVO', mcpUnavailable: 'SERVIDOR MCP INDISPONÍVEL', mcpInstructions: 'Conecte um cliente MCP neste computador e use o código da mesa para cada IA entrar.', mcpStartError: 'Não foi possível iniciar o servidor MCP local.',
    },
    chat: { open: 'Chat', compose: 'Diga algo', placeholder: 'Mensagem para a mesa…', message: 'Mensagem', emoji: 'Escolher emoji', characters: '{count} de {limit} caracteres', send: 'Enviar', shortcut: 'Abrir chat' },
    rooms: {
      title: 'Jogos', create: 'Criar mesa', joinCode: 'Entrar com código', createJoin: 'Criar mesa e entrar',
      roomName: 'Nome da mesa', password: 'Senha (opcional)', passwordIfAny: 'Senha, se houver', code: 'Código da mesa',
      enter: 'Entrar na mesa', watch: 'Assistir', entering: 'Conectando…', demo: 'Demonstração local', demoHint: 'Local · Teste seu deck',
      play: 'Jogar', preparing: 'Preparando…', searching: 'Buscando mesas…', empty: 'Nenhuma mesa online aberta.',
      more: 'Carregar mais mesas', loadingMore: 'Carregando…', unavailable: 'Mesas online indisponíveis neste dispositivo.',
      network: 'Sem conexão com o serviço de mesas. Verifique sua internet e tente novamente.',
      genericError: 'Não foi possível acessar as mesas.', passwordError: 'Senha incorreta. Confira o código e tente novamente.',
      protected: 'Protegida por senha', lobby: 'Aguardando jogadores', playing: 'Em andamento',
      players: '{count}/4 jogadores', people: '{count}/12 pessoas',
      passwordNote: 'A senha é uma barreira simples do aplicativo e pode ser contornada por clientes modificados.',
    },
    lobby: {
      inviteCode: 'CÓDIGO DA MESA', copyCode: 'Copiar código', codeCopied: 'Código da mesa copiado.', codeCopyFailed: 'Não foi possível copiar o código da mesa.',
      heading: 'A mesa se prepara.', subheading: 'Seu lugar está aqui.',
      chooseDeckDescription: 'Escolha uma lista Commander e confirme quando estiver pronto.',
      watching: 'Você está assistindo.', waitingPosition: 'Sua posição na fila é {position}.',
      emptySeat: 'Um lugar abrirá quando a partida terminar.', beforeTurn: 'ANTES DO PRIMEIRO TURNO', watchRoom: 'ACOMPANHE A SALA',
      prepareSeat: 'Prepare seu lugar.', followTable: 'A mesa segue por aqui.',
      readyDescription: 'Escolha seu deck e confirme sua presença. A partida começa quando todos na mesa estiverem prontos.',
      queueDescription: 'Prepare sua lista enquanto espera. Quando uma vaga abrir, você receberá um convite para entrar.',
      greeting: 'Olá, {name}', waitingQueue: 'Você está na fila de espera',
      deckReady: 'Deck selecionado · pronto para revisar', chooseDeckPrompt: 'Escolha um deck para liberar seu lugar',
      queueWatching: 'Posição {position} · você continua vendo a mesa', offerWaiting: 'Você receberá uma oferta quando alguém sair',
      changeDeck: 'Trocar deck', chooseDeck: 'Escolher deck', prepareDeck: 'Preparar um deck',
      ready: '✓ Confirmado', confirmSeat: 'Confirmar meu lugar',
      offerTitle: 'Uma vaga está aberta.', offerIntro: '{candidate} saiu de {seat}. Ao aceitar, você herda a mão, o deck e as permanentes desse lugar.',
      offerTimer: 'SEGUNDOS PARA RESPONDER', decline: 'Recusar oferta', accept: 'Aceitar vaga', entering: 'Entrando…',
      offerNote: 'Ao recusar, sua posição fica mantida para a próxima vaga.',
    },
    lobbyBoard: {
      overview: 'VISÃO GERAL DA MESA', ready: 'PRONTOS', seat: 'LUGAR', you: 'VOCÊ', available: 'Lugar disponível',
      choosingDeck: 'Escolhendo deck', reconnecting: 'RECONECTANDO', waitingPlayer: 'Aguardando jogador',
      playersAtTable: 'JOGADORES NA MESA', inQueue: 'NA FILA', yourSeat: 'SEU LUGAR', footer: '40 VIDAS · 100 CARTAS · COMMANDER',
      playerReady: 'PRONTO', online: 'ONLINE',
    },
    inspection: { label: 'Inspecionar {card}', close: 'Fechar inspeção', unavailable: 'O texto desta carta não está disponível.', deckQuantity: 'QUANTIDADE NO DECK · {count}', escapeClose: 'ESC PARA FECHAR' },
    cardTypes: { creature: 'Criaturas', planeswalker: 'Planeswalkers', instant: 'Instantâneas', sorcery: 'Feitiços', artifact: 'Artefatos', enchantment: 'Encantamentos', battle: 'Batalhas', land: 'Terrenos', other: 'Outros', commander: 'Comandantes' },
    colors: { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde' },
    deck: {
      library: 'SUA BIBLIOTECA', decks: 'Decks', new: 'Novo deck', localData: 'Cartas e imagens buscadas sob demanda', empty: 'Nenhum deck salvo. Comece com uma lista pronta ou importe a sua.',
      partnerSummary: 'PARCEIROS · 100 CARTAS', commanderSummary: 'COMMANDER · 100 CARTAS', chooseBackground: 'ESCOLHA UM PLANO DE FUNDO', defaultName: 'Meu deck Commander',
      synced: 'Sincronizado com a mesa', storedLocally: 'Seus decks ficam neste computador', cancel: 'Cancelar', backToTable: 'Voltar à mesa',
      backToLibrary: 'Voltar à biblioteca', officialPrecon: 'PRECON OFICIAL', inspectDeck: 'INSPEÇÃO DO DECK', noCommander: 'Sem comandante definido',
      copies: '{count} cópias', inspectCard: 'Inspecionar {card}', updating: 'Atualizando dados…', refreshProgress: '{loaded} de {total} cartas carregadas · faltam {remaining}', refreshCards: 'Atualizar dados das cartas', savedDeckKept: 'O deck salvo foi mantido.', removeSaved: 'Remover deck salvo', officialSource: 'FONTE OFICIAL', progressEstimate: 'estimativa',
      ready: 'Prontos', import: 'Importar', create: 'Criar deck', format: 'COMMANDER', chooseDeck: 'Escolha seu deck', loading: 'Carregando…', loadMore: 'Carregar mais decks',
      checkingCards: 'Conferindo cartas com o Scryfall…', emptyLibrary: 'Sua biblioteca está vazia.', firstVisit: 'Na primeira visita, buscamos as listas de Commander e guardamos as cartas usadas neste computador.',
      loadCards: 'Carregando cartas', loadPrecons: 'Carregar {count} precons', cached: 'Os dados ficam em cache; as imagens são carregadas conforme você navega.', colorFilter: 'Filtrar decks por identidade de cores', colors: 'CORES', deckCount: '{shown} de {total} decks', clearFilter: 'Limpar filtro',
      noColorDecks: 'Nenhum deck com essas cores.', clearOrChoose: 'Limpe o filtro ou escolha outra combinação.', choose: 'Escolher', details: 'Detalhes',
      inspectCards: 'Inspecionar cartas', export: 'Exportar .txt', syncing: 'Sincronizando…', useDeck: 'Usar este deck', savedWith: '“{name}” salvo com {count} cartas.',
      importTitle: 'Seu deck já está montado.', importHint: 'Cole o deck como texto, com os comandantes em uma seção separada.', acceptedFormat: 'FORMATO ACEITO',
      importFormatHelp: 'Duplique a linha do líder para adicionar um segundo comandante. O total deve fechar em 100.', importSavedWhileOpen: 'O texto continua salvo enquanto este editor estiver aberto.', checking: 'Verificando…', checkList: 'Só conferir a lista', fetchingCards: 'Buscando cartas…', saveAndCheck: 'Salvar e conferir',
      builder: 'CONSTRUTOR DE COMMANDER', buildFromCard: 'Monte a partir de uma carta.', builderHelp: 'Busque no Scryfall e adicione cartas ao deck. Deixamos as exceções visíveis.', deckName: 'NOME DO DECK',
      searchCards: 'BUSCAR CARTAS', searchPlaceholder: 'Nome, carta ou habilidade…', searching: 'Buscando…', search: 'Buscar', searchHelp: 'A busca consulta cartas liberadas para Commander. Metadados encontrados ficam no cache local.', colorless: 'Incolor', banned: 'BANIDA',
      commanderOne: 'COMANDANTE 1', commanderTwo: 'COMANDANTE 2', identity: 'Identidade: {colors}', partnershipCheck: 'A parceria será conferida pelo texto e tipo das cartas.', remove: 'Remover', addBasics: '＋ Adicionar 35 terrenos básicos pela identidade', inDeck: 'NO SEU DECK', cardCount: '{count} cartas', removeCopy: 'Remover uma cópia', addCopy: 'Adicionar uma cópia', noCardsYet: 'Nenhuma carta no deck ainda. Busque seu comandante para começar.', validateSave: 'Validar e salvar', validating: 'Validando…', deckNeedsChanges: 'Seu deck ainda precisa de ajustes',
      deckUpdated: 'Dados das cartas atualizados. A composição do deck foi mantida.', basicsAdded: '35 terrenos básicos foram adicionados. Complete as outras cartas até chegar a 100.',
      precombat: 'PRECON OFICIAL', deckColors: 'IDENTIDADE DE CORES', basicLands: 'TERRENOS BÁSICOS', officialCardsScryfall: 'CARTAS OFICIAIS · SCRYFALL',
      nextTurn: 'O próximo turno<br>começa por aqui.', chooseList: 'Escolha uma lista para ver a distribuição de cores e os dados do seu comandante.',
      possibilities: 'Uma mesa.<br>Muitas possibilidades.', deckRules: 'Decks Commander têm 100 cartas contando os comandantes. Terrenos básicos podem se repetir; confirme a identidade das cores e a legalidade.',
      commandersCount: 'comandantes', totalCards: 'cartas no total', bannedCards: 'cartas banidas',
      pasteList: 'Cole sua lista.<br>A mesa confere.', fileHelp: 'Resolvemos cartas com várias impressões, checamos restrições de Commander e mantemos a lista no cache local.', quantityName: '.TXT · QUANTIDADE + NOME',
      footerSaved: 'DECKS SALVOS NO DISPOSITIVO', footerSync: 'SINCRONIZAÇÃO PÚBLICA DA MESA AO CONFIRMAR', close: 'FECHAR',
      cardsGrouped: 'Cartas do deck agrupadas por tipo', reviewBeforePlay: 'Confira estes pontos antes de jogar', missingCards: 'Cartas não encontradas no Scryfall: {names}', deckSource: 'Origem do deck',
      commander: 'COMANDANTE', commanders: 'SEUS COMANDANTES', commanderPair: 'PAR DE COMANDANTES', commanderTax: 'TAXA DE CONJURAÇÃO · INDIVIDUAL', commandZone: 'ZONA DE COMANDO',
      cardsWord: 'cartas', noSearchMatch: 'Nenhuma carta encontrada com este termo.', recognized: 'Deck reconhecido. {count} cartas, pronto para salvar.',
      yourList: 'SUA LISTA', chooseNamed: 'Escolher {name}', detailsNamed: 'Detalhes de {name}', personalList: 'LISTA PESSOAL', leader: 'LÍDER',
      setPrimaryCommander: 'Definir como comandante principal', setSecondaryCommander: 'Definir como segundo comandante', add: 'Adicionar',
      tablePreview: 'VISUALIZAÇÃO DA MESA', tableForFour: 'MESA PARA QUATRO', deckDraft: 'RASCUNHO DO DECK', yourFile: 'SEU ARQUIVO', officialDataOnDemand: 'dados e imagens sob demanda',
      nextTurn1: 'O próximo turno', nextTurn2: 'começa por aqui.', possibilities1: 'Uma mesa.', possibilities2: 'Muitas possibilidades.', pasteList1: 'Cole sua lista.', pasteList2: 'A mesa confere.',
    },
    table: {
      step: 'Etapa', phase: 'Fase', untap: 'Desvirar', upkeep: 'Manutenção', drawStep: 'Compra',
      precombatMain: 'Principal pré-combate', combat: 'Combate', postcombatMain: 'Principal pós-combate', end: 'Final',
      paused: 'Partida pausada', finished: 'Partida encerrada', preparingHand: 'Preparando a mão', eliminated: 'Jogador eliminado',
      yourTurn: 'Seu turno', waitingTurn: 'Aguardando seu turno',
      nextStep: 'Próxima etapa', previousStep: 'Etapa anterior', phaseNavigation: 'Navegação pelas etapas do turno', emptySeat: 'Vazio', endTurn: 'Encerrar turno', history: 'Histórico', closeHistory: 'Fechar histórico',
      leave: 'SAIR DA MESA', you: 'VOCÊ', out: 'FORA', draw: 'Comprar', search: 'Buscar', shuffle: 'Embaralhar',
      gameTable: 'Mesa de jogo', appVersion: 'Versão {version}', updateApp: 'Atualize seu app', actionHistory: 'Histórico de ações', recentActions: 'Acontecimentos recentes', openActionLog: 'Abrir log completo. {count} acontecimentos recentes.', online: 'Online', offline: 'Offline', turnSteps: 'Etapas do turno',
      overview: 'Visão geral', ownSeat: 'Meu lugar', settings: 'Configurações', settingsSections: 'Seções de configuração', settingsTableTab: 'Mesa', disableCustomPlaymats: 'Desativar todos os playmats personalizados', disableCustomPlaymatsDescription: 'Oculta as artes personalizadas apenas na sua tela.', personalizePlaymat: 'Personalizar playmat', shortcuts: 'Atalhos',
      card: 'Carta', faceDownCard: 'Carta virada para baixo', hand: 'Sua mão: {count} cartas',
      liveRoom: 'SALA AO VIVO', localDemo: 'DEMONSTRAÇÃO LOCAL', round: 'RODADA {count}', pausedDescription: 'Aguardando {name} reconectar.', continueWithout: 'Continuar sem {name}', suspended: 'Afastado', synced: 'ESTADO SINCRONIZADO',
      life: 'VIDA', stepsHeading: 'ETAPAS DO TURNO', currentTurn: 'TURNO ATUAL', waiting: 'AGUARDANDO', eliminatedStatus: 'ELIMINADO',
      waitingPlayer: 'ESPERANDO JOGADOR', invitePlayer: 'Convide alguém para a mesa', gameZone: 'ZONA DE JOGO',
      poison: 'VENENO', commander: 'COMANDANTE', commanderDamage: 'DANO DE COMANDANTE', eliminationAt: '21 = ELIMINAÇÃO',
      mulligan: 'MULLIGAN {count} · ESCOLHA ATÉ {cards} CARTAS', keepHand: 'Manter mão',
      stack: 'PILHA', resolved: 'RESOLVIDO', readyResolve: 'PRONTA PARA RESOLVER', nextResponse: 'PRÓXIMA RESPOSTA', turnPlayer: 'JOGADOR DO TURNO',
      noPending: 'Nenhuma resposta pendente', youPassed: 'VOCÊ PASSOU', passPriority: 'PASSAR PRIORIDADE', waitingCast: 'ESPERANDO CONJURAÇÃO', revealedCards: 'CARTAS REVELADAS',
      emptyZone: 'Esta zona está vazia.', libraryActions: 'Ações da biblioteca', generalActions: 'Ações gerais',
      createToken: 'Criar ficha', resolveStack: 'Resolver topo', historyActions: 'Histórico de ações', concede: 'Conceder a partida',
      tokenLibraryEyebrow: 'BIBLIOTECA DE FICHAS DE CRIATURA', tokenLibraryTitle: 'Escolha uma ficha de criatura.', tokenLibraryDescription: 'Escolha uma ficha para colocá-la diretamente no campo de batalha.', tokenSearchLabel: 'BUSCAR FICHAS', tokenSearchPlaceholder: 'Nome da ficha ou tipo de criatura', onlyDeckTokens: 'Somente fichas do deck', noDeckTokens: 'Este deck não possui fichas de criatura associadas.', tokenGroups: 'Fichas de criatura agrupadas por tipo', tokenCount: 'fichas', tokenLoading: 'Carregando fichas de criatura…', noTokenResults: 'Nenhuma ficha de criatura encontrada para esta busca.', noTokens: 'Nenhuma ficha de criatura disponível.', loadMoreTokens: 'Carregar mais fichas', createNamedToken: 'Criar {card}',
      drawCard: 'Comprar carta', searchLibrary: 'Buscar na biblioteca', shuffleLibrary: 'Embaralhar biblioteca',
      yourPlaymatControls: 'Controles ao lado do seu playmat', commanderDamageLabel: 'Dano de comandante',
      tableShortcuts: 'Atalhos de teclado', buyShortcut: 'COMPRAR', tapShortcut: 'VIRAR', undoShortcut: 'DESFAZER', redoShortcut: 'REFAZER', targetShortLabel: 'DAR ALVO', middleMouse: 'BOTÃO DO MEIO', doubleClick: 'CLIQUE DUPLO', rightMouse: 'BOTÃO DIREITO', tapMouse: 'Virar / desvirar uma carta que você controla', scrollHelp: 'Aproximar a mesa ou inspecionar uma carta', contextHelp: 'Abrir o menu de opções',
      playmatDialog: 'Personalizar playmat', playmatEyebrow: 'SEU ESPAÇO NA MESA', choosePlaymat: 'Escolha seu playmat.', applyPlaymat: 'Aplicar playmat',
      greenFelt: 'Feltro verde', officialMagicArt: 'Arte oficial de Magic: The Gathering', noActions: 'Nenhuma ação registrada ainda.',
      searchDialog: 'BUSCA PRIVADA · SÓ SUA BIBLIOTECA', findCard: 'Encontre uma carta.', privateSearchDescription: 'Os nomes escolhidos não aparecem no histórico público. Ao concluir, sua biblioteca será embaralhada.',
      searchLabel: 'BUSCAR NA BIBLIOTECA', searchPlaceholder: 'Nome, tipo ou texto Oracle', groupedCards: 'Cartas da biblioteca agrupadas por tipo',
      noSearchResults: 'Nenhuma carta encontrada para esta busca.', emptyLibrary: 'Sua biblioteca está vazia.', destination: 'DESTINO',
      yourHand: 'Sua mão', battlefield: 'Campo de batalha', selectedCards: 'carta(s) selecionada(s)', maxSearchCards: 'Escolha até 20 cartas por busca.',
      finishSearch: 'Concluir e embaralhar', commanderControls: 'MESA DE COMMANDER · CONTROLES', playYourWay: 'Jogue do seu jeito.',
      helpIntro: 'A mesa acompanha estados e ações comuns. Efeitos das cartas, alvos e combate continuam sob decisão dos jogadores.',
      drawOne: 'Comprar uma carta', undoAction: 'Desfazer última ação', redoAction: 'Refazer ação', tapSelected: 'Virar / desvirar a carta sob o mouse ou, sem ela, a selecionada',
      flipSelected: 'Alternar a face selecionada', selectMove: 'Selecionar ou mover permanentes', lookAround: 'Olhar suavemente ao redor do seu lugar',
      touchPan: 'Arrastar o fundo para olhar em telas de toque', cancelSelection: 'Cancelar seleção', understood: 'Entendi',
      action: 'Ação', stackAction: 'MAGIA', abilityAction: 'HABILIDADE', passKey: 'PASSOU',
      searchNameLabel: 'Nome, tipo ou texto Oracle', revealedBy: 'Revelado por',
      minuteTime: '{time}', scrollCardsEnd: 'Rolar cartas para o fim',
      tapped: 'virou', untapped: 'desvirou',
      opponentHand: 'Mão de {name}: {count} carta | Mão de {name}: {count} cartas', inHand: 'na mão',
      libraryOf: 'Deck de {name} · {count} carta | Deck de {name} · {count} cartas',
      confirmConcede: 'Conceder a partida? Seu lugar será marcado como eliminado e a mesa continuará.', confirmTransferControl: 'Passar o controle da carta para {name}?', passControl: 'Passar controle',
      commanderZoneQuestion: 'Enviar {name} para a zona de comando? Se recusar, ela irá para o destino escolhido.', sendToCommand: 'Enviar à zona de comando', keepDestination: 'Manter destino escolhido',
      targetAnnounceHighlight: '{author} destacou {target}.', targetAnnounceArrow: '{author} deu alvo em {target} com {origin}.', targetSelect: 'Selecionar este alvo', targetFrom: 'Dar alvo com esta carta', targetChoose: 'Selecione o destino', targetShortcut: 'Destacar ou arrastar para dar alvo',
      menuPrivateLibrary: 'Biblioteca privada', buyCard: 'Comprar carta', searchLibraryMenu: 'Buscar na biblioteca', shuffleLibraryMenu: 'Embaralhar biblioteca',
      menuInspect: 'Inspecionar', menuPlay: 'Jogar terreno', menuCast: 'Conjurar', menuReveal: 'Revelar esta carta', menuDiscard: 'Descartar para o cemitério', menuTap: 'Desvirar', menuUntap: 'Virar', menuFlip: 'Trocar face', menuFaceDown: 'Virar para baixo', menuRevealFaceDown: 'Revelar esta carta', menuCounter: 'Marcador +1/+1', menuGraveyard: 'Mover ao cemitério', menuExile: 'Exilar', menuHand: 'Devolver à mão',
      graveyard: 'Cemitério', exile: 'Exílio', graveyardOf: 'Cemitério de {name} · {count} carta | Cemitério de {name} · {count} cartas', exileOf: 'Exílio de {name} · {count} carta | Exílio de {name} · {count} cartas', scrollCardsStart: 'Rolar cartas para o início', copies: '{count} cópias',
      zoneEmpty: 'Esta zona está vazia.', handCount: 'NA MÃO', openZoneAside: 'Abrir {zone} para o lado', searchZone: 'Buscar em {zone}', searchLabelPublic: 'BUSCAR NESTA ZONA', cardsCount: 'cartas', zoneFanPrevious: 'Mostrar carta anterior', zoneFanNext: 'Mostrar próxima carta', zoneFanStackPrevious: '{count} cartas anteriores; mostrar uma', zoneFanStackNext: '{count} próximas cartas; mostrar uma',
      lifeOf: 'Vida de {name}', decreaseLife: 'Diminuir vida de {name}', increaseLife: 'Aumentar vida de {name}', commanderLabel: 'Comandante: {name}',
      reduceCommanderDamage: 'Diminuir dano recebido de {commander} de {player}', increaseCommanderDamage: 'Aumentar dano recebido de {commander} de {player}', damageReceived: 'Dano recebido de {commander} de {player}',
      mulliganAction: 'Mulligan', handCard: 'Carta na mão',
      steps: { 'Desvirar': 'Desvirar', 'Manutenção': 'Manutenção', 'Compra': 'Compra', 'Principal pré-combate': 'Principal pré-combate', 'Combate': 'Combate', 'Principal pós-combate': 'Principal pós-combate', 'Final': 'Final' },
      zones: { library: 'Biblioteca', hand: 'Mão', battlefield: 'Campo', graveyard: 'Cemitério', exile: 'Exílio', command: 'Zona de comando', stack: 'Pilha' },
    },
    gameLog: {
      draw: '{actor} comprou uma carta. | {actor} comprou {count} cartas.', mulligan: '{actor} pediu mulligan ({count}).', keep: '{actor} confirmou a mão.',
      playLand: '{actor} jogou {card}.', move: '{actor} moveu {card} para {zone}.', tap: '{actor} {verb} {card}.',
      life: '{actor} ajustou a vida de {player} em {amount}.', counter: '{actor} ajustou {counter} em {amount} em {target}.',
      commanderDamage: '{actor} causou {amount} de dano de comandante a {player}.', cast: '{actor} conjurou {card}.',
      ability: '{actor} ativou uma habilidade de {card}.', pass: '{actor} passou prioridade.', resolve: '{actor} resolveu {card}.',
      phase: '{actor}: {step}.', endTurn: '{actor} encerrou o turno. É a vez de {player}.', shuffle: '{actor} embaralhou sua biblioteca.',
      concede: '{actor} concedeu a partida.', token: '{actor} criou a ficha {card}.',
      reveal: '{actor} revelou {cards}.', search: '{actor} procurou em sua biblioteca e escolheu {count} carta(s).',
      transfer: '{actor} transferiu o controle de {card} para {player}.', flipFace: '{actor} virou {card} para a outra face.',
      faceDown: '{actor} virou uma carta para baixo.', revealFaceDown: '{actor} revelou uma carta virada para baixo.', reposition: '{actor} reposicionou {card}.',
      undo: 'Desfez: {source}', redo: 'Refez: {source}',
    },
    errors: {
      unknown: 'Algo deu errado. Tente novamente.', firebaseNetwork: 'Não foi possível conectar ao Firebase. Verifique sua conexão.',
      firebaseConfig: 'Ative Authentication e o provedor Anônimo no console do Firebase para conectar jogadores.',
      scryfallNetwork: 'Não foi possível conectar ao Scryfall. Verifique sua conexão.',
      scryfallUnavailable: 'O Scryfall está temporariamente indisponível. Tente novamente.',
      network: 'A conexão falhou. Verifique sua internet e tente novamente.', actionRejected: 'A mesa recusou esta jogada.', actionPending: 'A jogada anterior ainda está sincronizando. Aguarde.',
      deckSync: 'Não foi possível sincronizar o deck.', directoryUnavailable: 'Diretório indisponível',
    },
  },
} as const;

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: 'en',
  fallbackLocale: 'en',
  messages,
});

export function setDocumentLocale(locale: AppLocale): void {
  document.documentElement.lang = locale;
  document.title = i18n.global.t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', i18n.global.t('meta.description'));
}

export function initializeLocale(preference: unknown, languages: readonly string[] | undefined): LanguagePreference {
  initialPreference = normalizePreference(preference);
  const locale = resolveLocale(initialPreference, languages);
  i18n.global.locale.value = locale;
  localeRevision.value++;
  setDocumentLocale(locale);
  return initialPreference;
}

export function formatGameLogEvent(event: GameLogEvent): string {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(event.params ?? {})) {
    if (typeof value === 'string' && value.startsWith('table.')) params[name] = i18n.global.t(value);
    else params[name] = value;
  }
  if (event.source) params.source = formatGameLogEvent(event.source);
  const count = typeof params.count === 'number' ? params.count : undefined;
  return count === undefined ? i18n.global.t(event.key, params) : i18n.global.t(event.key, params, count);
}

export function errorMessageKey(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.toLowerCase();
  let key = 'errors.unknown';
  if (/permission-denied|permission_denied|senha incorreta|incorrect password/.test(normalized)) key = 'rooms.passwordError';
  else if (/failed to fetch|network|unavailable|offline|connection|conexão|conect/.test(normalized)) key = 'errors.network';
  else if (/scryfall/.test(normalized)) key = 'errors.scryfallUnavailable';
  else if (/sync.*deck|sincronizar o deck/.test(normalized)) key = 'errors.deckSync';
  else if (/diretório indisponível|directory unavailable/.test(normalized)) key = 'errors.directoryUnavailable';
  else if (/firebase|authentication|anonymous provider/.test(normalized)) key = 'errors.firebaseConfig';
  else if (/nome.*pelo menos|at least two letters/.test(normalized)) key = 'app.nameInvalid';
  else if (/mesa.*não está mais disponível|table.*no longer available/.test(normalized)) key = 'rooms.unavailable';
  else if (/a jogada não é permitida|action is not allowed|jogada.*permitida/.test(normalized)) key = 'errors.actionRejected';
  else if (/a última jogada ainda está sincronizando|sincronizando/.test(normalized)) key = 'errors.actionPending';
  return key;
}
export function localizeError(error: unknown): string { return i18n.global.t(errorMessageKey(error)); }

export type MessageKey = string;
export type MessageParams = Record<string, string | number>;
