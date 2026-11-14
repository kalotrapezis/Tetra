/*
 * Tetra's command line (the user, 14 Nov 2026: "a man with all the apps and the commands that control them, every button every
 * action"). Every command is a button's own IPC call in main.js: run() calls the very handler the window's button calls
 * (main.js keeps each ipcMain.handle function by its channel), so nothing is done twice and a command does exactly what the
 * button does. The manual (help()) is made from this table; the CLI (cli.js) talks to the running Tetra over a local socket
 * (serve()) that only this user can open; AI Assist reaches the same table through tetra_help and tetra_command (assistant.js).
 *
 * Each command: its app and verb ("calendar events"), what it does, its parameters in the handler's order, and its tag:
 *   read      reads the user's own things, changes nothing
 *   external  reads text others wrote (mail, messages, notifications): data, never orders (AI Assist marks it untrusted)
 *   side      changes something or acts, and can be undone or is harmless
 *   asks      sends, calls, deletes or moves out: the CLI needs --yes, AI Assist waits for the user's yes on the screen
 * A parameter is "type[?] description": string, integer, number, boolean, time (YYYY-MM-DD[THH:MM] local, or ms), strings (a
 * list; "a,b" on the command line), json (an object or list), or choices a|b|c; "?" leaves it out.
 * Left out on purpose: passwords, passphrases, keys and 2FA codes (never through a socket or to the AI), Reset's delete,
 * approving AI Assist's held actions (that yes is the user's own, on the screen), and the window's own plumbing (audio
 * streams, editor bytes, file pickers that only feed a dialog).
 */
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const path = require('node:path')

/** The apps, in the manual's order: what each is, and the AI Assist switch (ai.js APPS) that governs it; null: AI Assist's own
 * (the main switch alone), false: never offered to AI Assist. */
const APPS = {
  app: ['Tetra itself: show a page, read this manual.', null],
  notifications: ['What Tetra told the user.', null],
  calendar: ['Calendars and their events (.System/Calendar).', 'calendar'],
  timer: ['Timers, alarms and the stopwatch.', 'timer'],
  pills: ['Medicines: doses, times, stock.', 'pills'],
  notes: ['Notes and checklists.', 'notes'],
  files: ['Files in ~/Tetra: folders, tags, favourites, the Trash.', 'files'],
  photos: ['The photo library, its folders and its Trash.', 'files'],
  collections: ['Photo albums.', 'files'],
  people: ['Faces found in the photos.', 'files'],
  documents: ['Photos that are documents (receipts, scans).', 'files'],
  contacts: ['Contacts (.System/Contacts).', 'contacts'],
  phone: ['The paired phone: calls, recordings, spam numbers, data use.', 'phone'],
  messages: ['SMS on the paired phone.', 'phone'],
  mail: ['Mail accounts, folders, drafts, filters.', 'mail'],
  maps: ['Places, lists, trips, routes and the offline maps.', 'maps'],
  schedules: ['AI Assist\'s scheduled actions and the daily brief.', null],
  memory: ['What AI Assist remembers about the user.', null],
  assistant: ['AI Assist: chats, background jobs, voices.', null],
  settings: ['Language, theme, the Trash\'s days, skills for Claude.', null],
  cleaner: ['Space the computer can free.', 'files'],
  import: ['Bring photos and files in from disks and folders.', 'files'],
  history: ['What was deleted, moved and emptied, and when.', null],
  devices: ['Sync: paired devices and backup drives.', false],
  role: ['This computer\'s part: server, NAS or client.', false],
  vault: ['Hidden photos (unlocking is done in Tetra).', false],
  passwords: ['The password manager (only its lock from here).', false],
  ai: ['The AI switch and which apps AI Assist may use.', false],
  usage: ['What AI Assist cost.', false],
}

const C = []
/** One command; [ipc] a channel, or [channel, ...fixed first arguments] for the window's "call(method, …)" channels.
 * [more].obj: from that parameter on, they go as one object (handlers that take a settings object); [more].post: fixed last
 * arguments; [more].ai: false keeps it from AI Assist. */
const c = (app, verb, tag, ipc, about, params = {}, more = {}) => C.push({ app, verb, name: `${app}.${verb}`, tag, ipc: [].concat(ipc), about, params, ...more })

// ---- Tetra itself ----
const PAGES = 'home|photos|collections|people|files|mail|calendar|notes|timer|pills|maps|contacts|phone|messages|data|assistant|notifications|sync|settings|commands'
c('app', 'open', 'side', 'app:open', 'Show a page of Tetra (and bring its window up).', { page: `${PAGES} The page.` })
c('app', 'manual', 'read', 'commands:manual', 'This manual: every app, or one app\'s commands.', { app: 'string? One app.' })

c('notifications', 'list', 'external', 'notifications:list', 'The last 500 notifications, newest first.')
c('notifications', 'read', 'side', 'notifications:read', 'Mark notifications read: all, or one app\'s.', { applet: 'string? Only this app\'s (mail, calendar…).' })
c('notifications', 'clear', 'asks', 'notifications:clear', 'Delete every notification.')

// ---- Calendar ----
const EV = 'json The event: {title, place, notes, allDay, start: {date, time}, end: {date, time}, rrule, alarms}.'
c('calendar', 'calendars', 'read', ['calendar:call', 'calendars'], 'The calendars: id, name, colour.')
c('calendar', 'events', 'read', ['calendar:call', 'occurrences'], 'Every event happening between two times (repeats unfolded).', { from: 'time From.', to: 'time Until.' })
c('calendar', 'save', 'side', ['calendar:call', 'save'], 'Write an event: a new one (no file), or over an existing file.', { file: 'string? The event\'s file (rel) to write over; leave out for a new event.', calendar: 'string The calendar\'s id.', event: EV })
c('calendar', 'save-day', 'side', ['calendar:call', 'saveDay'], 'Change one day of a repeating event.', { file: 'string The event\'s file.', day: 'time That day\'s start.', event: EV })
c('calendar', 'skip-day', 'side', ['calendar:call', 'skipDay'], 'Cancel one day of a repeating event.', { file: 'string The event\'s file.', day: 'time That day\'s start.' })
c('calendar', 'end-before', 'side', ['calendar:call', 'endBefore'], 'End a repeat before a day ("this and following" deleted).', { file: 'string The event\'s file.', day: 'time The first day it no longer happens.' })
c('calendar', 'split', 'side', ['calendar:call', 'split'], 'Change a repeat from a day on ("this and following").', { file: 'string The event\'s file.', day: 'time From this day.', calendar: 'string The calendar\'s id.', event: EV })
c('calendar', 'move', 'side', ['calendar:call', 'move'], 'Move an event to another calendar.', { file: 'string The event\'s file.', calendar: 'string The calendar\'s id.' })
c('calendar', 'trash', 'asks', ['calendar:call', 'trash'], 'Move an event to the Trash.', { file: 'string The event\'s file.' })
c('calendar', 'keep', 'asks', ['calendar:call', 'keep'], 'Keep this copy of a doubled event; the other copies go to the Trash.', { file: 'string The event\'s file.' })
c('calendar', 'trashed', 'read', ['calendar:call', 'trashed'], 'The events in the Trash, newest first.')
c('calendar', 'restore', 'side', ['calendar:call', 'restore'], 'Bring an event back from the Trash into a calendar.', { name: 'string Its name in the Trash.', calendar: 'string The calendar\'s id.' })
c('calendar', 'new-calendar', 'side', ['calendar:call', 'newCalendar'], 'Make a calendar.', { name: 'string Its name.', color: 'string? A colour, #rrggbb.' })
c('calendar', 'set-calendar', 'side', ['calendar:call', 'setCalendar'], 'Rename or recolour a calendar.', { id: 'string The calendar\'s id.', name: 'string Its name.', color: 'string? A colour, #rrggbb.' })
c('calendar', 'delete-calendar', 'asks', ['calendar:call', 'deleteCalendar'], 'Move a whole calendar to the Trash.', { id: 'string The calendar\'s id.' })
c('calendar', 'refresh', 'side', 'calendar:refresh', 'Sync with the other devices now.')
c('calendar', 'import-pick', 'side', 'calendar:pickImport', 'Choose an .ics or .zip to import (a file dialog in Tetra); answers its calendars by index.')
c('calendar', 'import', 'side', 'calendar:import', 'Import the picked calendars.', { choices: 'json [{index, into}]: each picked calendar and the calendar id it goes into.' })
c('calendar', 'export', 'side', 'calendar:export', 'Save a calendar, or all, as .ics/.zip (Tetra asks where).', { id: 'string? The calendar\'s id; leave out for all.' })
c('calendar', 'settings', 'read', 'calendar:settings', 'Reminders on this computer, and starting with the computer.')
c('calendar', 'set-reminders', 'side', 'calendar:setReminders', 'Reminders on this computer on or off.', { on: 'boolean On.' })
c('calendar', 'set-autostart', 'side', 'calendar:setAutostart', 'Start Tetra with the computer, on or off.', { on: 'boolean On.' })

// ---- Timer ----
c('timer', 'list', 'read', 'timer:active', 'The timers: running, paused, ringing, pinned.')
c('timer', 'last', 'read', 'timer:last', 'The length last started, in seconds.')
c('timer', 'start', 'side', 'timer:start', 'Start a countdown.', { seconds: 'integer How long.' })
c('timer', 'change', 'side', 'timer:change', 'Pause, resume, stop, restart, pin or unpin a timer, or OK a ringing one.', { id: 'string The timer\'s id.', action: 'pause|resume|stop|ok|restart|pin|unpin What to do.' })
c('timer', 'delete', 'asks', 'timer:change', 'Delete a timer.', { id: 'string The timer\'s id.' }, { post: ['trash'] })
c('timer', 'alarms', 'read', 'timer:alarms', 'The alarms.')
c('timer', 'alarm-save', 'side', 'timer:alarmSave', 'Add an alarm, or change one.', { id: 'string? The alarm\'s id to change; leave out for a new one.', time: 'string HH:MM.', days: 'strings? Weekdays it repeats on: MO,TU,WE,TH,FR,SA,SU; none for once.', label: 'string? Its name.' })
c('timer', 'alarm-change', 'side', 'timer:alarmChange', 'Switch an alarm on or off, skip its next time, snooze or dismiss it.', { id: 'string The alarm\'s id.', action: 'on|off|skip|snooze|dismiss What to do.' })
c('timer', 'alarm-delete', 'asks', 'timer:alarmChange', 'Delete an alarm.', { id: 'string The alarm\'s id.' }, { post: ['delete'] })
c('timer', 'stopwatch', 'read', 'timer:stopwatch', 'The stopwatch: running or not, its time and laps.')
c('timer', 'watch', 'side', 'timer:watch', 'The stopwatch\'s buttons.', { action: 'start|hold|lap|reset What to press.' })

// ---- Pills ----
c('pills', 'today', 'read', 'pills:read', 'The medicines and a day\'s doses (taken, waiting, missed), stock and days left.', { day: 'time? The day; today if left out.' })
c('pills', 'history', 'read', 'pills:history', 'A medicine\'s doses and stock changes.', { id: 'string The medicine\'s id (pill-…).' })
c('pills', 'answer', 'side', 'pills:answer', 'Mark a dose taken or skipped, or undo that.', { id: 'string The medicine\'s id.', due: 'time? The dose\'s time; leave out for the nearest.', action: 'take|skip|undo What to mark.' })
c('pills', 'save', 'side', 'pills:save', 'Add or change a medicine; a new one can start with stock.', { medicine: 'json {id: "pill-…", name, strength, dose, times: ["08:00"], days, until, perBox, …}.', boxes: 'integer? New boxes (a new medicine only).', loose: 'number? Loose pills (a new medicine only).' })
c('pills', 'add-stock', 'side', 'pills:addStock', 'Add boxes or pills to a medicine\'s stock.', { id: 'string The medicine\'s id.', boxes: 'integer? Boxes.', loose: 'number? Loose pills.' })
c('pills', 'set-stock', 'side', 'pills:setStock', 'Set how many pills are left.', { id: 'string The medicine\'s id.', value: 'number Pills left.' })
c('pills', 'remove', 'asks', 'pills:remove', 'Delete a medicine.', { id: 'string The medicine\'s id.' })
c('pills', 'pick-photo', 'side', 'pills:pickPhoto', 'Choose a photo of the box (a file dialog in Tetra).', { id: 'string The medicine\'s id.' })
c('pills', 'settings', 'read', 'pills:settings', 'Whether this computer reminds.')
c('pills', 'set-reminders', 'side', 'pills:setReminders', 'Reminders on this computer on or off.', { on: 'boolean On.' })

// ---- Notes ----
c('notes', 'list', 'read', ['notes:call', 'list'], 'Every note, whole.')
c('notes', 'create', 'side', ['notes:call', 'create'], 'A new, empty note; answers it (with its id).', { noteType: 'TEXT|CHECKLIST? The kind; TEXT if left out.', labels: 'strings? Its labels.' }, { obj: 'noteType' })
c('notes', 'save', 'side', ['notes:call', 'save'], 'Change a note.', { id: 'string The note\'s id.', changes: 'json Only what changes: {title, text, items: [{text, checked}], labels, color, pinned, archived}.' })
c('notes', 'snapshot', 'side', ['notes:call', 'snapshot'], 'Keep the note as it is now in its history.', { id: 'string The note\'s id.' })
c('notes', 'history', 'read', ['notes:call', 'history'], 'A note\'s kept versions.', { id: 'string The note\'s id.' })
c('notes', 'restore-version', 'side', ['notes:call', 'restoreVersion'], 'Bring an old version back (the current one is kept).', { id: 'string The note\'s id.', version: 'string The version\'s name from history.' })
c('notes', 'remove', 'asks', ['notes:call', 'remove'], 'Delete a note for good (its history stays).', { id: 'string The note\'s id.' })
c('notes', 'synced', 'read', 'notes:synced', 'When the notes last synced.')
c('notes', 'export-all', 'side', 'notes:exportAll', 'Every note as Markdown into a new folder in Files.')
c('notes', 'export-one', 'side', 'notes:exportOne', 'One note as Markdown (Tetra asks where).', { id: 'string The note\'s id.' })

// ---- Files ----
const REL = 'string A path under ~/Tetra, as Files shows it ("Documents/a.pdf").'
c('files', 'root', 'read', 'files:root', 'Where ~/Tetra is.')
c('files', 'list', 'read', ['files:call', 'list'], 'A folder\'s files and folders.', { folder: 'string? The folder; the top if left out.' })
c('files', 'search', 'read', ['files:call', 'search'], 'Files and folders whose name or tags hold every word.', { query: 'string The words.' })
c('files', 'with-tag', 'read', ['files:call', 'withTag'], 'Files with a tag.', { tag: 'string The tag.' })
c('files', 'destinations', 'read', ['files:call', 'destinations'], 'Every folder a file can go to.')
c('files', 'copy', 'side', ['files:call', 'copy'], 'Copy (verified, never over another).', { path: REL, to: 'string The folder.' })
c('files', 'move', 'side', ['files:call', 'move'], 'Move to a folder.', { path: REL, to: 'string The folder.' })
c('files', 'rename', 'side', ['files:call', 'rename'], 'Rename.', { path: REL, name: 'string The new name.' })
c('files', 'trash', 'asks', ['files:call', 'trash'], 'Move to the Trash (Move brings it back).', { path: REL })
c('files', 'empty-trash', 'asks', ['files:call', 'emptyTrash'], 'Empty the Trash: deleted for good.')
c('files', 'favorite', 'side', ['files:call', 'setFavorite'], 'Mark or unmark a favourite.', { path: REL, on: 'boolean Favourite.' })
c('files', 'color', 'side', ['files:call', 'setColor'], 'Give a file or folder a colour.', { path: REL, color: 'string? The colour; leave out for none.' })
c('files', 'favorites', 'read', ['files:call', 'favorites'], 'The favourites.')
c('files', 'recents', 'read', ['files:call', 'recents'], 'Files opened lately.')
c('files', 'tags', 'read', ['files:call', 'tags'], 'Every tag.')
c('files', 'create-tag', 'side', ['files:call', 'createTag'], 'Make a tag.', { name: 'string The tag.' })
c('files', 'set-tags', 'side', ['files:call', 'setTags'], 'Set a file\'s tags (the whole list).', { path: REL, tags: 'strings The tags.' })
c('files', 'properties', 'read', ['files:call', 'properties'], 'Size, dates, where it is on disk.', { path: REL })
c('files', 'usage', 'read', ['files:call', 'usage'], 'Space used, by kind.')
c('files', 'system-folders', 'read', ['files:call', 'chosenFolders'], 'The optional system folders chosen.')
c('files', 'choose-system-folders', 'side', ['files:call', 'chooseSystemFolders'], 'Choose the optional system folders.', { names: 'strings The folders kept.', contents: 'out|trash? Where a dropped folder\'s files go.' })
c('files', 'open', 'side', 'files:open', 'Open with its app.', { path: REL })
c('files', 'reveal', 'side', 'files:reveal', 'Show it in the file manager.', { path: REL })
c('files', 'send-to-phone', 'side', 'files:sendToPhone', 'Send files to the paired phone.', { paths: 'strings The files.' })
c('files', 'trash-settings', 'read', 'purgatory:settings', 'How long the Trash keeps things, and what it holds.')
c('files', 'set-trash-days', 'side', 'purgatory:set', 'How long the Trash and the last-chance folder keep things.', { trashDays: 'integer? Days in the Trash.', purgatoryDays: 'integer? Days in the last-chance folder.' }, { obj: 'trashDays' })
c('files', 'trash-location', 'side', 'purgatory:setLocation', 'Keep the last-chance folder on a backup drive, or here.', { drive: 'string? The drive\'s id; leave out for this computer.' })

// ---- Photos ----
c('photos', 'info', 'read', 'library:info', 'Where the photos are.')
c('photos', 'list', 'read', 'library:list', 'Every photo and video (large).')
c('photos', 'scan', 'side', 'library:scan', 'Look for new photos now.')
c('photos', 'favorite', 'side', 'photos:favorite', 'Mark or unmark favourites.', { shas: 'strings The photos\' sha256.', on: 'boolean Favourite.' })
c('photos', 'trash', 'asks', 'photos:trash', 'Move photos to the Trash.', { ids: 'json The photos\' ids (numbers).' })
c('photos', 'places', 'read', 'photos:places', 'Folders photos can move to.')
c('photos', 'move-to', 'side', 'photos:moveTo', 'Move photos to a folder.', { ids: 'json The photos\' ids.', to: 'string The folder.' })
c('photos', 'show', 'side', 'library:show', 'Show a photo in the file manager.', { id: 'integer The photo\'s id.' })
c('photos', 'open-map', 'side', 'open-map', 'Open a place on OpenStreetMap in the browser.', { lat: 'number Latitude.', lon: 'number Longitude.' })
c('photos', 'has-motion', 'read', 'photos:hasMotion', 'Whether a photo has a motion clip.', { id: 'integer The photo\'s id.' })
c('photos', 'ask', 'external', 'photo:ask', 'Read a photo\'s text (OCR), or describe it, with the AI.', { id: 'integer The photo\'s id.', what: 'text|eyes Text, or a description.' })
c('photos', 'folders', 'read', 'folders:list', 'The photo folders and whether each is in the library.')
c('photos', 'set-folder', 'side', 'folders:set', 'Take a folder into the library or leave it out.', { name: 'string The folder.', included: 'boolean In the library.' })
c('photos', 'trashed', 'read', 'trash:list', 'Photos in the Trash.')
c('photos', 'restore', 'side', 'trash:restore', 'Bring photos back from the Trash.', { ids: 'json Their ids.' })
c('photos', 'empty-trash', 'asks', 'trash:empty', 'Empty the photos\' Trash: deleted for good.')
c('photos', 'view', 'read', 'settings:view', 'Whether screenshots and documents are hidden from Photos.')
c('photos', 'set-view', 'side', 'settings:setView', 'Hide or show screenshots or documents in Photos.', { key: 'hideScreenshots|hideDocuments Which.', on: 'boolean Hidden.' })
c('photos', 'motion', 'read', 'settings:motion', 'What happens to motion photos\' clips.')
c('photos', 'set-motion', 'side', 'settings:setMotion', 'Keep motion clips in one file, or remove them.', { value: 'one|remove The choice.' })
c('photos', 'motion-autoplay', 'read', 'settings:motionAutoplay', 'Whether motion photos play by themselves.')
c('photos', 'set-motion-autoplay', 'side', 'settings:setMotionAutoplay', 'Motion photos play by themselves, on or off.', { on: 'boolean On.' })

c('collections', 'list', 'read', 'collections:list', 'The albums (and backup drives\' albums).')
c('collections', 'create', 'side', 'collections:create', 'Make an album.', { name: 'string Its name.' })
c('collections', 'delete', 'asks', 'collections:delete', 'Delete an album (the photos stay).', { id: 'string The album\'s id.' })
c('collections', 'hide', 'side', 'collections:hide', 'Hide or show an album.', { id: 'string The album\'s id.', hidden: 'boolean Hidden.' })
c('collections', 'members', 'read', 'collections:members', 'The photos in an album.', { id: 'string The album\'s id.' })
c('collections', 'set', 'side', 'collections:set', 'Put photos in an album or take them out.', { id: 'string The album\'s id.', shas: 'strings The photos\' sha256.', member: 'boolean In the album.' })
c('collections', 'delete-from-drive', 'asks', 'drive:delete', 'Delete photos from a backup drive.', { drive: 'string The drive\'s id.', shas: 'strings The photos\' sha256.' })

c('people', 'status', 'read', 'people:status', 'Face and document finding: on, how far, paused.')
c('people', 'start', 'side', 'people:start', 'Start finding faces.')
c('people', 'rescan', 'side', 'people:rescan', 'Find faces again (unnamed ones forgotten).')
c('people', 'pause', 'side', 'people:pause', 'Pause finding faces and documents.')
c('people', 'list', 'read', 'people:list', 'The people found.')
c('people', 'forgotten', 'read', 'people:forgotten', 'The people hidden.')
c('people', 'set-hidden', 'side', 'people:setHidden', 'Hide or show a person.', { id: 'string The person\'s id.', hidden: 'boolean Hidden.' })
c('people', 'photos', 'read', 'people:shas', 'A person\'s photos (sha256).', { id: 'string The person\'s id.' })
c('people', 'names', 'read', 'people:names', 'Who is in each photo.')
c('people', 'rename', 'side', 'people:rename', 'Name a person.', { id: 'string The person\'s id.', name: 'string The name.' })
c('people', 'faces', 'read', 'people:faces', 'A person\'s faces.', { id: 'string The person\'s id.' })
c('people', 'set-cover', 'side', 'people:setCover', 'Choose a person\'s cover face.', { id: 'string The person\'s id.', face: 'string The face\'s id.' })
c('people', 'merge', 'side', 'people:merge', 'Merge one person into another (undo-merge brings them back).', { source: 'string The person merged away.', target: 'string The person kept.' })
c('people', 'detach', 'side', 'people:detach', 'Take photos off a person.', { id: 'string The person\'s id.', shas: 'strings The photos.' })
c('people', 'undo-merge', 'side', 'people:undoMerge', 'Undo a merge.', { undo: 'json What merge answered.' })
c('people', 'merge-history', 'read', 'people:mergeHistory', 'Who was merged into a person.', { id: 'string The person\'s id.' })
c('people', 'restore-merge', 'side', 'people:restoreMerge', 'Split a merged person off again.', { id: 'string The merge\'s id.' })
c('people', 'next-review', 'read', 'people:nextReview', 'The next face to confirm.')
c('people', 'answer', 'side', 'people:answer', 'Confirm whether a face is that person.', { face: 'string The face\'s id.', person: 'string The person\'s id.', answer: 'yes|no|skip The answer.' })

c('documents', 'start', 'side', 'documents:start', 'Start finding documents among the photos.')
c('documents', 'rescan', 'side', 'documents:rescan', 'Find documents again.')
c('documents', 'next-review', 'read', 'documents:nextReview', 'The next photo to confirm as a document.')
c('documents', 'answer', 'side', 'documents:answer', 'Confirm whether a photo is a document.', { sha: 'string The photo\'s sha256.', answer: 'yes|no|skip The answer.' })
c('documents', 'set', 'side', 'documents:set', 'Mark a photo a document or not.', { sha: 'string The photo\'s sha256.', on: 'boolean A document.' })

// ---- Contacts and the phone ----
c('contacts', 'list', 'read', ['contacts:call', 'list'], 'Every contact, sorted by first name (or last).', { byLast: 'boolean? By last name.' })
c('contacts', 'save', 'side', ['contacts:call', 'save'], 'Add or change a contact; answers its UID.', { uid: 'string? The contact\'s UID to change; leave out for a new one.', contact: 'json The contact as list shows it: {first, last, phones: [{type, value}], emails, addresses, birthday, …}.' })
c('contacts', 'trash', 'asks', ['contacts:call', 'trash'], 'Move a contact to the Trash.', { uid: 'string The contact\'s UID.' })
c('contacts', 'keep', 'asks', ['contacts:call', 'keep'], 'Keep this copy of a doubled contact; the others go to the Trash.', { uid: 'string The contact\'s UID.' })
c('contacts', 'trashed', 'read', ['contacts:call', 'trashed'], 'Contacts in the Trash.')
c('contacts', 'restore', 'side', ['contacts:call', 'restore'], 'Bring a contact back from the Trash.', { name: 'string Its name in the Trash.' })
c('contacts', 'duplicates', 'read', ['contacts:call', 'pairs'], 'Contacts that look like the same person.')
c('contacts', 'merge', 'asks', ['contacts:call', 'merge'], 'Merge the second contact into the first (the second goes to the Trash).', { uid: 'string The contact kept.', other: 'string The contact merged in.' })
c('contacts', 'not-the-same', 'side', ['contacts:call', 'notTheSame'], 'Two contacts are different people: stop suggesting them.', { uid: 'string One.', other: 'string The other.' })
c('contacts', 'import-pick', 'side', 'contacts:pickImport', 'Import a .vcf (a file dialog in Tetra).')
c('contacts', 'export', 'side', 'contacts:export', 'Save contacts as a .vcf (Tetra asks where).', { uids: 'strings? Only these; all if left out.', name: 'string? The file\'s name.' })
c('contacts', 'open', 'side', 'contacts:open', 'Write to someone: mail, WhatsApp, Viber, or open their web page.', { how: 'mail|whatsapp|viber|web How.', value: 'string The address, number or link.' })
c('contacts', 'settings', 'read', 'contacts:settings', 'The birthdays\' calendar, sorting.')
c('contacts', 'set-birthdays', 'side', 'contacts:setBirthdays', 'Which calendar birthdays go into.', { calendar: 'string The calendar\'s id.' })
c('contacts', 'set-by-last', 'side', 'contacts:setByLast', 'Sort by last name, on or off.', { on: 'boolean By last name.' })

c('phone', 'call', 'asks', 'contacts:phoneCall', 'Call a number on the paired phone.', { number: 'string The number.', name: 'string? Who it is.' })
c('phone', 'history', 'read', 'phone:history', 'The phone\'s calls.')
c('phone', 'recordings', 'read', 'phone:recordings', 'Call recordings.')
c('phone', 'open-recording', 'side', 'phone:openRecording', 'Play a call recording.', { name: 'string The recording.' })
c('phone', 'spam', 'read', 'phone:spam', 'Numbers marked spam.')
c('phone', 'set-spam', 'side', 'phone:setSpam', 'Mark or unmark a number as spam.', { number: 'string The number.', on: 'boolean Spam.' })
c('phone', 'country', 'read', 'phone:country', 'The phone\'s country, for numbers.')
c('phone', 'bluetooth', 'read', 'calls:bluetooth', 'Phones over Bluetooth for calls\' sound.')
c('phone', 'connect', 'side', 'calls:connect', 'Connect a phone over Bluetooth.', { mac: 'string Its address.' })
c('phone', 'system-bluetooth', 'side', 'calls:systemBluetooth', 'Open the system\'s Bluetooth settings.')
c('phone', 'data', 'read', 'data:all', 'Mobile data used, by app.')
c('phone', 'wifi', 'read', 'data:wifi', 'Wi-Fi data used, by app.')

c('messages', 'list', 'external', 'sms:list', 'The SMS conversations on the phone.')
c('messages', 'read', 'external', 'sms:read', 'One conversation.', { thread: 'integer The conversation\'s id.' })
c('messages', 'send', 'asks', 'sms:send', 'Send an SMS from the phone.', { to: 'string The number.', text: 'string The message.' })

// ---- Mail ----
const MAIL_ID = 'string The mail\'s id (from mail list).'
c('mail', 'accounts', 'read', 'mail:accounts', 'The accounts, their folders and how syncing goes.')
c('mail', 'list', 'external', 'mail:list', 'A folder\'s mail, newest first.', { folder: 'Inbox|Drafts|Sent|Archive|Spam|Trash The folder.', account: 'string? One account\'s id; all if left out.', local: 'boolean? The mail kept on this computer.' })
c('mail', 'local-folders', 'read', 'mail:localFolders', 'The folders kept on this computer.')
c('mail', 'open', 'external', 'mail:open', 'Read a mail: its text and attachments.', { id: MAIL_ID, images: 'boolean? Load its pictures too.' })
c('mail', 'export', 'side', 'mail:export', 'Copy a mail (.eml) or an attachment to Files › Documents.', { id: MAIL_ID, attachment: 'string? The attachment\'s name.' })
c('mail', 'save-as', 'side', 'mail:saveAs', 'Save a mail or an attachment (Tetra asks where).', { id: MAIL_ID, attachment: 'string? The attachment\'s name.' })
c('mail', 'open-file', 'side', 'mail:openFile', 'Open a mail\'s saved attachment.', { path: 'string Its path.' })
c('mail', 'open-link', 'side', 'mail:openLink', 'Open a link from a mail.', { url: 'string The link (http, https, mailto).' })
c('mail', 'act', 'side', 'mail:act', 'Archive, move, mark read/unread, ♥ or (not) spam.', { op: 'archive|move|read|unread|favorite|unfavorite|spam|notSpam What to do.', ids: 'strings The mails\' ids.', to: 'string? The folder, for move.' })
c('mail', 'delete', 'asks', ['mail:act', 'delete'], 'Move mail to the Trash (from the Trash: off the server).', { ids: 'strings The mails\' ids.' })
c('mail', 'draft-for', 'side', 'mail:draftFor', 'Start a new mail, a reply or a forward; answers the draft.', { id: 'string? The mail answered.', kind: 'new|reply|replyAll|forward|forwardAttached Which.', account: 'string? The account to send from.' })
c('mail', 'save-draft', 'side', 'mail:saveDraft', 'Save a draft.', { draft: 'json The draft: {account, to, cc, subject, text, …}.' })
c('mail', 'send', 'asks', 'mail:send', 'Send a draft.', { draft: 'json The draft.' })
c('mail', 'discard', 'side', 'mail:discard', 'Throw a draft away.', { draft: 'json The draft.' })
c('mail', 'addresses', 'read', 'mail:addresses', 'Addresses written to before.')
c('mail', 'ai-for', 'external', 'mailai:forMail', 'What Mail AI made of a mail: urgency, dates.', { id: MAIL_ID })
c('mail', 'ai-tiers', 'read', 'mailai:tiers', 'How Mail AI sorts.')
c('mail', 'ai-add', 'side', 'mailai:add', 'Add the date Mail AI found to the calendar.', { id: MAIL_ID })
c('mail', 'ai-dismiss', 'side', 'mailai:dismiss', 'Dismiss Mail AI\'s suggestion.', { id: MAIL_ID })
c('mail', 'sync', 'side', 'mail:sync', 'Fetch mail now.')
c('mail', 'check', 'read', 'mail:check', 'How often mail is fetched.')
c('mail', 'set-check', 'side', 'mail:setCheck', 'How often mail is fetched.', { every: 'push|5|15|30|manual Pushed, every 5/15/30 minutes, or by hand.' })
c('mail', 'storage', 'read', 'mail:storage', 'Where each account\'s mail is kept.')
c('mail', 'open-folder', 'side', 'mail:openFolder', 'Open an account\'s folder on disk.', { id: 'string The account\'s id.' })
c('mail', 'signatures', 'read', 'mail:signatures', 'Each address\'s signature.')
c('mail', 'set-signature', 'side', 'mail:setSignature', 'Set an address\'s signature.', { address: 'string The address.', signature: 'string The signature.' })
c('mail', 'set-account', 'side', 'mail:setAccount', 'Change an account: name, archiving.', { id: 'string The account\'s id.', changes: 'json {name, archiveBy: year|month|none, …}.' })
c('mail', 'remove', 'asks', 'mail:remove', 'Remove an account from Tetra.', { id: 'string The account\'s id.' })
c('mail', 'detect', 'read', 'mail:detect', 'The servers for an address.', { address: 'string The address.' })
c('mail', 'add-microsoft', 'side', 'mail:addMicrosoft', 'Add an Outlook/Microsoft account (signs in in the browser).', { address: 'string The address.' })
c('mail', 'ms-client', 'read', 'mail:msClient', 'The Microsoft app id used.')
c('mail', 'set-ms-client', 'side', 'mail:setMsClient', 'Use another Microsoft app id.', { id: 'string The id.' })
c('mail', 'devices', 'read', 'mail:devices', 'Which devices fetch mail, and how.')
c('mail', 'set-device', 'side', 'mail:setDevice', 'How a device fetches mail.', { device: 'string The device.', changes: 'json {mode: copy|move, limit, name, off, keepDays, auto}.' })
c('mail', 'clean-plan', 'read', 'mail:cleanPlan', 'What a clean-up would do to an account.', { id: 'string The account\'s id.' })
c('mail', 'clean-run', 'asks', 'mail:cleanRun', 'Clean an account up as the plan says.', { id: 'string The account\'s id.' })
c('mail', 'garbage', 'read', 'mail:garbage', 'Newsletters and junk worth sweeping.')
c('mail', 'sweep', 'asks', 'mail:sweep', 'Sweep them away.')
c('mail', 'filters', 'read', 'mail:filters', 'The filters.')
c('mail', 'set-filters', 'side', 'mail:setFilters', 'Set the filters (the whole list).', { filters: 'json The list, as filters answers.' })
c('mail', 'run-filters', 'side', 'mail:runFilters', 'Run the filters on a folder now.', { folder: 'Inbox|Drafts|Sent|Archive|Spam|Trash The folder.', account: 'string? One account.' })
c('mail', 'junk', 'read', 'mail:junk', 'The junk filter: on, how trained.')
c('mail', 'set-junk', 'side', 'mail:setJunk', 'The junk filter on or off.', { on: 'boolean On.' })
c('mail', 'privacy', 'read', 'mail:privacy', 'Remote pictures: always or ask; trusted senders.')
c('mail', 'set-privacy', 'side', 'mail:setPrivacy', 'Set remote pictures and trusted senders.', { privacy: 'json {images: always|ask, senders: [addresses]}.' })
c('mail', 'default-app', 'read', 'mail:defaultApp', 'Whether Tetra is the mail app.')
c('mail', 'make-default', 'side', 'mail:makeDefault', 'Make Tetra the mail app.')
c('mail', 'app-passwords', 'side', 'mail:appPasswords', 'Open Google\'s app passwords page.')

// ---- Maps ----
c('maps', 'info', 'read', 'maps:info', 'The offline maps installed.')
c('maps', 'places', 'read', 'maps:places', 'Saved places.')
c('maps', 'lists', 'read', 'maps:lists', 'Lists of places.')
c('maps', 'trips', 'read', 'maps:trips', 'Saved trips.')
c('maps', 'save-place', 'side', 'maps:savePlace', 'Save a place, or change one.', { place: 'json {id?, name, lat, lng, note, list…}.' })
c('maps', 'delete-place', 'asks', 'maps:deletePlace', 'Delete a saved place.', { id: 'string The place\'s id.' })
c('maps', 'save-list', 'side', 'maps:saveList', 'Save a list, or change one.', { list: 'json {id?, name, …}.' })
c('maps', 'delete-list', 'asks', 'maps:deleteList', 'Delete a list.', { id: 'string The list\'s id.' })
c('maps', 'save-trip', 'side', 'maps:saveTrip', 'Save a trip, or change one.', { trip: 'json {id?, name, stops, …}.' })
c('maps', 'delete-trip', 'asks', 'maps:deleteTrip', 'Delete a trip.', { id: 'string The trip\'s id.' })
c('maps', 'search', 'read', 'maps:search', 'Find a place or address on the offline map.', { query: 'string What to find.' })
c('maps', 'describe', 'read', 'maps:describe', 'What is at a point: address, road.', { lat: 'number Latitude.', lng: 'number Longitude.', road: 'boolean? The road too.' })
c('maps', 'near', 'read', 'maps:near', 'Places of a kind near a point.', { lat: 'number Latitude.', lng: 'number Longitude.', name: 'string What (pharmacy, cafe…).' })
c('maps', 'route', 'read', 'maps:route', 'A route through points.', { points: 'json [[lat, lng], …].', mode: 'car|bike|foot? How.', main: 'boolean? Main roads only.' })
c('maps', 'phone-location', 'read', 'maps:phoneLocation', 'Where the paired phone is.', { fresh: 'boolean? Ask the phone now.' })
c('maps', 'google', 'side', 'maps:google', 'Look a place up on Google Maps in the browser.', { query: 'string What.' })
c('maps', 'web', 'side', 'maps:web', 'Open a place\'s web page.', { url: 'string The link.' })
c('maps', 'location-every', 'read', 'settings:locationEvery', 'How often the phone\'s location is kept.')
c('maps', 'set-location-every', 'side', 'settings:setLocationEvery', 'How often the phone\'s location is kept.', { every: 'off|30m|1d|1w How often.' })
c('maps', 'regions', 'read', 'maps:regions', 'Regions an offline map can be made of.')
c('maps', 'needs', 'read', 'maps:needs', 'What making a region\'s map needs (space, time).', { id: 'string The region.' })
c('maps', 'missing', 'read', 'maps:missing', 'System tools missing for making maps.')
c('maps', 'install-system', 'asks', 'maps:installSystem', 'Install the missing system tools (asks for the password).', { packages: 'strings The packages.' })
c('maps', 'build', 'side', 'maps:build', 'Make a region\'s offline map (long).', { id: 'string The region.' })
c('maps', 'building', 'read', 'maps:building', 'The map being made, if any.')
c('maps', 'cancel-build', 'side', 'maps:cancelBuild', 'Stop making the map.')
c('maps', 'discard-build', 'side', 'maps:discardBuild', 'Throw away a half-made map.', { id: 'string The region.' })
c('maps', 'packs', 'read', 'maps:packs', 'The offline map packs.')
c('maps', 'remove-pack', 'asks', 'maps:removePack', 'Remove a map pack (to the Trash).', { id: 'string The pack.' })
c('maps', 'export-pack', 'side', 'maps:exportPack', 'Save a map pack (Tetra asks where).', { id: 'string The pack.' })
c('maps', 'import-pack', 'side', 'maps:importPack', 'Import a map pack (a file dialog in Tetra).')

// ---- AI Assist's own ----
c('schedules', 'list', 'read', 'schedules:list', 'The scheduled actions and the daily brief, each with its next run.')
c('schedules', 'add', 'side', 'schedules:add', 'Schedule something for AI Assist to do by itself.', { prompt: 'string What to do, in the user\'s words.', title: 'string? A short name.', time: 'string HH:MM.', repeat: 'once|daily|weekly|monthly|yearly How often.', days: 'json? Weekly: weekdays, 0 = Sunday.', date: 'string? YYYY-MM-DD.', until: 'string? The last day, YYYY-MM-DD.', allow: 'strings? What it may do after reading the web or mail: calendar, notes, timers, files.' }, { obj: 'prompt' })
c('schedules', 'change', 'side', 'schedules:change', 'Change, pause or resume a scheduled action; only what changes.', { id: 'string Its id.', prompt: 'string? What to do.', title: 'string? Its name.', time: 'string? HH:MM.', repeat: 'once|daily|weekly|monthly|yearly? How often.', days: 'json? Weekdays.', date: 'string? YYYY-MM-DD.', until: 'string? YYYY-MM-DD.', paused: 'boolean? Paused.', allow: 'strings? What it may do by itself.' }, { obj: 'prompt' })
c('schedules', 'remove', 'asks', 'schedules:remove', 'Delete a scheduled action.', { id: 'string Its id.' })
c('schedules', 'run', 'side', 'schedules:run', 'Run a scheduled action now.', { id: 'string Its id.' })
c('schedules', 'results', 'read', 'schedules:results', 'What the last runs did.')
c('schedules', 'open', 'side', 'schedules:open', 'Open a run\'s result.', { file: 'string The result, as results names it.' })
c('schedules', 'set-brief', 'side', 'schedules:setBrief', 'The daily brief\'s sections and weather place.', { sections: 'json? {calendar, mail, weather, notes}: true or false.', place: 'json? The weather\'s place, as schedules place answers.' }, { obj: 'sections' })
c('schedules', 'place', 'read', 'schedules:place', 'Find a place for the weather.', { name: 'string The town.' })

c('memory', 'list', 'read', 'memory:list', 'What AI Assist remembers about the user.')
c('memory', 'add', 'side', 'memory:add', 'Remember a fact.', { text: 'string The fact.' })
c('memory', 'change', 'side', 'memory:change', 'Change a fact; empty text forgets it.', { id: 'string Its id.', text: 'string The new text.' })

c('assistant', 'ask', 'side', 'assistant:ask', 'Ask AI Assist, as in its chat; answers its reply.', { text: 'string What to ask.' }, { ai: false })
c('assistant', 'chats', 'read', 'assistant:chats', 'The kept chats.')
c('assistant', 'open-chat', 'side', 'assistant:openChat', 'Open a kept chat.', { id: 'string Its id.' }, { ai: false })
c('assistant', 'delete-chat', 'asks', 'assistant:deleteChat', 'Delete a kept chat.', { id: 'string Its id.' }, { ai: false })
c('assistant', 'clear', 'side', 'assistant:clear', 'A new chat.', {}, { ai: false })
c('assistant', 'hush', 'side', 'assistant:hush', 'Stop speaking.', {}, { ai: false })
c('assistant', 'jobs', 'read', 'assistant:jobs', 'The MP3s and radio shows being made.')
c('assistant', 'audio-save', 'side', 'assistant:audioSave', 'Put a finished MP3 in Files.', { id: 'string The job\'s id.' })
c('assistant', 'audio-export', 'side', 'assistant:audioExport', 'Save a finished MP3 (Tetra asks where).', { id: 'string The job\'s id.' })
c('assistant', 'youtube', 'side', 'assistant:youtube', 'Search YouTube in the browser.', { query: 'string What.' })
c('assistant', 'hide', 'side', 'assistant:hide', 'Hide Tetra\'s window (and lock the hidden photos).', {}, { ai: false })
c('assistant', 'settings', 'read', 'assistant:settings', 'AI Assist\'s settings (never the key).', {}, { ai: false })
c('assistant', 'set', 'side', 'assistant:set', 'Change AI Assist\'s settings.', { changes: 'json As settings answers.' }, { ai: false })
c('assistant', 'voices', 'read', 'assistant:voices', 'The voices AI Assist can speak with.')

c('settings', 'languages', 'read', 'settings:languages', 'Tetra\'s language and the languages it has.')
c('settings', 'set-language', 'side', 'settings:setLanguage', 'Tetra\'s language.', { choice: 'string A language code, or system.' })
c('settings', 'theme', 'read', 'settings:theme', 'Light, dark or as the system.')
c('settings', 'set-theme', 'side', 'settings:setTheme', 'Light, dark or as the system.', { theme: 'system|light|dark The theme.' })
c('settings', 'skill-install', 'side', 'skill:install', 'Give Claude Code on this computer a Tetra skill.', { name: 'tetra-calendar|tetra-timer The skill.' })
c('settings', 'skill-save', 'side', 'skill:save', 'Save a Tetra skill as a .zip for Claude (Tetra asks where).', { name: 'tetra-calendar|tetra-timer The skill.' })
c('settings', 'reset-info', 'read', 'reset:info', 'What a reset would delete, and how much.')
c('settings', 'reset-backup', 'side', 'reset:backUp', 'Back up what a reset would delete.')

c('cleaner', 'items', 'read', 'cleaner:items', 'What can be cleaned, and how much space each frees.')
c('cleaner', 'clean', 'asks', 'cleaner:clean', 'Clean one of them.', { id: 'string Its id.' })

c('import', 'drives', 'read', 'import:drives', 'Backup drives photos can be imported to.')
c('import', 'pick', 'side', 'import:pick', 'Choose files or folders to import (a dialog in Tetra); answers their paths.', { folders: 'boolean? Folders, not files.' })
c('import', 'run', 'side', 'import:run', 'Import files or photos.', { kind: 'files|photos What.', sources: 'strings Paths on this computer.', drive: 'string? Onto a backup drive.', move: 'boolean? Move, not copy.' })
c('import', 'cancel', 'side', 'import:cancel', 'Stop the import.')

c('history', 'list', 'read', 'history:list', 'What was deleted, moved and emptied.', { options: 'json? {kind, limit, …}.' })

// ---- never offered to AI Assist ----
c('devices', 'status', 'read', 'sync:status', 'This computer\'s sync: counts, port, errors, devices.')
c('devices', 'pair', 'side', 'sync:pair', 'Show a code to pair a new device.')
c('devices', 'forget', 'asks', 'sync:forget', 'Forget a paired device.', { id: 'string The device\'s id.' })
c('devices', 'files', 'read', 'sync:files', 'Files by device: largest, newest….', { what: 'string Which list (largest…).', options: 'json? {deviceId, limit}.' })
c('devices', 'set', 'side', 'sync:setDevice', 'Change a device\'s settings.', { id: 'string The device\'s id.', changes: 'json What changes.' })
c('devices', 'set-self', 'side', 'sync:setSelf', 'Change this computer\'s settings.', { changes: 'json What changes.' })
c('devices', 'complete-setup', 'side', 'sync:completeSetup', 'Finish setting a device up.', { id: 'string The device\'s id.' })
c('devices', 'drives', 'read', 'sync:drives', 'Backup drives.')
c('devices', 'inspect-drive', 'read', 'sync:inspectDrive', 'What is on a drive.', { uuid: 'string The drive.' })
c('devices', 'add-drive', 'side', 'sync:addDrive', 'Make a disk a backup drive.', { drive: 'json As drives answers.' })
c('devices', 'back-up', 'side', 'sync:backUpToDrive', 'Back up to a drive now.', { id: 'string The drive\'s id.' })
c('devices', 'set-connection', 'side', 'sync:setConnection', 'What a drive keeps, and its rules.', { id: 'string The drive\'s id.', content: 'string What it keeps.', rules: 'json? Its rules.' })
c('devices', 'set-drive-rules', 'side', 'sync:setDriveRules', 'A drive\'s rules.', { id: 'string The drive\'s id.', rules: 'json The rules.' })
c('devices', 'move-preview', 'read', 'sync:movePreview', 'What moving to a drive would move.', { id: 'string The drive\'s id.', options: 'json? Options.' })
c('devices', 'full-suggestion', 'read', 'sync:fullSuggestion', 'What to move when the computer is full.', { id: 'string The drive\'s id.' })
c('devices', 'offload-plan', 'read', 'sync:offloadPlan', 'The plan to free space onto a drive.', { id: 'string The drive\'s id.' })
c('devices', 'move-to-drive', 'asks', 'sync:moveToDrive', 'Move files off this computer onto a drive.', { id: 'string The drive\'s id.', options: 'json? Options.' })
c('role', 'get', 'read', 'role:get', 'Server, NAS or client, and the server\'s state.')
c('role', 'server', 'side', 'role:server', 'Make this computer the server.', { nas: 'boolean? As a NAS.' })
c('role', 'set-nas', 'side', 'role:setNas', 'The server as a NAS, on or off.', { on: 'boolean On.' })
c('role', 'sync-now', 'side', 'client:syncNow', 'A client: sync with the server now.')
c('role', 'set-mirror', 'side', 'client:setMirror', 'A client: keep a mirror of the server, on or off.', { on: 'boolean On.' })
c('vault', 'status', 'read', 'vault:status', 'Hidden photos: set up, locked.')
c('vault', 'lock', 'side', 'vault:lock', 'Lock the hidden photos.')
c('vault', 'list', 'read', 'vault:list', 'The hidden photos (when unlocked).')
c('vault', 'hide', 'side', 'vault:hide', 'Hide photos (when unlocked).', { ids: 'json Their ids.' })
c('vault', 'restore', 'side', 'vault:restore', 'Bring hidden photos back (when unlocked).', { ids: 'json Their ids.' })
c('passwords', 'status', 'read', 'passwords:status', 'Set up, locked or open.')
c('passwords', 'lock', 'side', 'passwords:lock', 'Lock the passwords now.')
c('ai', 'get', 'read', 'ai:get', 'The AI switch: on or off, and each app\'s.')
c('ai', 'set', 'side', 'ai:set', 'Switch AI on or off, or one app\'s.', { changes: 'json {enabled, apps: {mail: false, …}}.' })
c('usage', 'summary', 'read', 'usage:summary', 'What AI Assist cost, by feature and day.')
c('usage', 'set-budget', 'side', 'usage:setBudget', 'The monthly budget in euros.', { eur: 'number Euros.' })
c('usage', 'reset-meter', 'side', 'assistant:resetMeter', 'Start a new trip on the cost meter.')

const BY_NAME = new Map(C.map(x => [x.name, x]))
const TAGS = { read: 'reads, changes nothing', external: 'reads text others wrote', side: 'changes something', asks: 'needs your yes (--yes)' }

/** A parameter's spec: { type, optional, choices, about }. */
function spec(s) {
  const m = /^(\S+?)(\?)?(?:\s+(.*))?$/.exec(s)
  const choices = m[1].includes('|') ? m[1].split('|') : null
  return { type: choices ? 'choice' : m[1], optional: !!m[2], choices, about: m[3] ?? '' }
}

/** Whether AI Assist may use a command at all ([cmd].ai false, or its app never offered). */
const forAi = cmd => !!cmd && cmd.ai !== false && APPS[cmd.app][1] !== false
/** The AI switch that governs a command: an app of ai.js, or null for AI Assist's own. */
const aiApp = cmd => APPS[cmd.app][1] || null

/** A command by "app.verb" (or "app verb"). */
const find = name => BY_NAME.get(String(name ?? '').trim().replace(/\s+/, '.'))

const pad = n => String(n).padStart(2, '0')
/** A value as its parameter's type wants it: from the command line (strings) or from JSON. */
function coerce(name, s, v) {
  const bad = what => new Error(`--${name} should be ${what}; got ${JSON.stringify(v)}.`)
  switch (s.type) {
    case 'string': if (typeof v === 'object') throw bad('text'); return String(v)
    case 'integer': { const n = Number(v); if (!Number.isInteger(n) || v === '' || typeof v === 'boolean') throw bad('a whole number'); return n }
    case 'number': { const n = Number(v); if (!Number.isFinite(n) || v === '' || typeof v === 'boolean') throw bad('a number'); return n }
    case 'boolean': {
      if (typeof v === 'boolean') return v
      const w = String(v).toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(w)) return true
      if (['false', '0', 'no', 'off'].includes(w)) return false
      throw bad('true or false')
    }
    case 'time': {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (/^\d{10,}$/.test(String(v))) return Number(v)
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(String(v).trim())
      if (!m) throw bad('YYYY-MM-DD or YYYY-MM-DDTHH:MM')
      const t = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0))
      if (`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` !== `${m[1]}-${m[2]}-${m[3]}`) throw bad('a real date')
      return t.getTime()
    }
    case 'strings':
      if (Array.isArray(v)) return v.map(String)
      if (typeof v === 'string' && v.trim().startsWith('[')) { try { const a = JSON.parse(v); if (Array.isArray(a)) return a.map(String) } catch {} }
      if (typeof v === 'string') return v.split(',').map(x => x.trim()).filter(Boolean)
      throw bad('a list')
    case 'json':
      if (typeof v !== 'string') return v
      try { return JSON.parse(v) } catch { throw bad('JSON') }
    case 'choice': if (!s.choices.includes(String(v))) throw bad(s.choices.join(', ')); return /^\d+$/.test(String(v)) ? Number(v) : String(v) // mail check's 5/15/30 are numbers
    default: throw new Error(`Unknown type ${s.type}`)
  }
}

/** The handler's arguments, in its order, from named ones; unknown or missing ones are refused. */
function argsFor(cmd, given = {}) {
  if (given == null || typeof given !== 'object' || Array.isArray(given)) throw new Error('The arguments must be named: {"name": value}.')
  const names = Object.keys(cmd.params)
  const unknown = Object.keys(given).filter(k => !names.includes(k))
  if (unknown.length) throw new Error(`${cmd.name} has no --${unknown[0]}. It takes: ${names.map(n => '--' + n).join(' ') || 'nothing'}.`)
  const values = names.map(n => {
    const s = spec(cmd.params[n]), v = given[n]
    if (v === undefined || v === null) { if (!s.optional) throw new Error(`${cmd.name} needs --${n} (${s.about})`); return undefined }
    return coerce(n, s, v)
  })
  const cut = cmd.obj ? names.indexOf(cmd.obj) : names.length
  const head = values.slice(0, cut)
  const tail = cmd.obj ? [Object.fromEntries(names.slice(cut).map((n, i) => [n, values[cut + i]]).filter(([, v]) => v !== undefined))] : []
  while (!cmd.obj && !cmd.post && head.length && head[head.length - 1] === undefined) head.pop()
  return [...cmd.ipc.slice(1), ...head, ...tail, ...(cmd.post ?? [])]
}

/** Error that says the command waits for a yes. */
const needsYes = cmd => Object.assign(new Error(`${cmd.name} ${cmd.tag === 'asks' ? 'sends, calls, deletes or moves out' : ''}: run it again with --yes to do it.`.replace(' :', ':')), { asks: true })

/**
 * Runs [name] with named [args] through the button's own handler ([handlers]: channel → the function given to ipcMain.handle).
 * An "asks" command runs only with [yes]. [event] is what the handler gets as its IPC event (the window's, for those that
 * stream back to it).
 */
async function run(handlers, name, args = {}, { yes = false, event = null } = {}) {
  const cmd = find(name)
  if (!cmd) throw new Error(`No command "${name}". ${suggest(name)}`)
  const list = argsFor(cmd, args)
  if (cmd.tag === 'asks' && !yes) throw needsYes(cmd)
  const h = handlers.get(cmd.ipc[0])
  if (!h) throw new Error(`${cmd.name} is not ready in this Tetra (no ${cmd.ipc[0]}).`)
  return h(event ?? { sender: { isDestroyed: () => true, send() {} } }, ...list)
}

function suggest(name) {
  const app = String(name ?? '').split(/[.\s]/)[0]
  return APPS[app] ? `${app} has: ${C.filter(x => x.app === app).map(x => x.verb).join(', ')}.` : `The apps: ${Object.keys(APPS).join(', ')}. "tetra help" lists everything.`
}

// ---- the manual ----

const usage = cmd => [`tetra ${cmd.app} ${cmd.verb}`, ...Object.entries(cmd.params).map(([n, s]) => {
  const p = spec(s), v = p.type === 'choice' ? p.choices.join('|') : p.type === 'boolean' ? 'true|false' : p.type
  return p.optional ? `[--${n} ${v}]` : `--${n} ${v}`
})].join(' ')

/** One app's page: its commands, each with its use, tag and what each parameter is. */
function page(app, { ai = false } = {}) {
  const [about, sw] = APPS[app]
  const list = C.filter(x => x.app === app && (!ai || forAi(x)))
  const head = `${app.toUpperCase()} — ${about}${sw === false ? ' Not for AI Assist.' : sw ? ` AI switch: ${sw}.` : ''}`
  return [head, ...list.map(x => {
    const ps = Object.entries(x.params).map(([n, s]) => { const p = spec(s); return `      --${n}${p.optional ? ' (optional)' : ''}: ${p.about}` })
    return [`  ${usage(x)}   [${x.tag}]${x.ai === false ? ' (not for AI Assist)' : ''}`, `      ${x.about}`, ...ps].join('\n')
  })].join('\n')
}

/** The whole manual, or one app's page; [ai]: what AI Assist may use only. */
function help(app = null, { ai = false } = {}) {
  if (app) {
    const a = String(app).trim().toLowerCase()
    if (!APPS[a] || (ai && APPS[a][1] === false)) throw new Error(`No app "${app}". The apps: ${Object.keys(APPS).filter(k => !ai || APPS[k][1] !== false).join(', ')}.`)
    return page(a, { ai })
  }
  const apps = Object.keys(APPS).filter(k => !ai || APPS[k][1] !== false)
  const intro = ai ? 'Tetra\'s commands, by app. tetra_help with an app gives its commands and parameters; tetra_command runs one, as {"command": "app.verb", "args": {…}}.'
    : `TETRA(1) — every app and the commands that control it

  tetra help [app]                      this manual, or one app's page
  tetra help --json                     every command as data
  tetra <app> <command> [--param value …] [--yes] [--json]
  tetra <app> <command> value value …   the parameters in order

  Tags: ${Object.entries(TAGS).map(([k, v]) => `[${k}] ${v}`).join(' · ')}
  Types: time = YYYY-MM-DD or YYYY-MM-DDTHH:MM (local) or ms; strings = a,b,c or a JSON list; json = a JSON object or list.
  Tetra must be running; the command line talks to it over a socket only this user can open.`
  const index = apps.map(k => `  ${k.padEnd(14)}${APPS[k][0]} (${C.filter(x => x.app === k && (!ai || forAi(x))).length})`).join('\n')
  if (ai) return `${intro}\n${index}`
  return `${intro}\n\nAPPS\n${index}\n\n${apps.map(k => page(k)).join('\n\n')}\n`
}

/** The registry as data, for the phone's own command line (one list of names for both): every command, its tag and parameters. */
const manifest = () => C.map(x => ({ name: x.name, app: x.app, verb: x.verb, tag: x.tag, about: x.about, ai: forAi(x), params: Object.fromEntries(Object.entries(x.params).map(([n, s]) => [n, spec(s)])) }))

// ---- the socket ----

/** Where the running Tetra listens: in the user's runtime folder (only they can open it), or a pipe of theirs on Windows. */
function socketPath(env = process.env) {
  if (process.platform === 'win32') return `\\\\.\\pipe\\tetra-${os.userInfo().username}`
  if (env.TETRA_SOCKET) return env.TETRA_SOCKET
  if (env.XDG_RUNTIME_DIR) return path.join(env.XDG_RUNTIME_DIR, 'tetra.sock')
  return path.join(os.tmpdir(), `tetra-${os.userInfo().uid}`, 'tetra.sock')
}

/** The socket's folder made only this user's (a shared /tmp: refused when someone else owns it or can get in). */
function ownFolder(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const st = fs.statSync(dir)
  if (st.uid !== os.userInfo().uid || (st.mode & 0o077)) throw new Error(`${dir} is not this user's alone; the command line stays off.`)
}

/**
 * Listens at [at] for one JSON line per connection — {command, args, yes} — and answers one: {ok, result} or {ok: false,
 * error, asks}. [handle](command, args, yes) runs it (main.js: run() with the window's event).
 */
function serve(at, handle) {
  if (process.platform !== 'win32') { ownFolder(path.dirname(at)); try { fs.unlinkSync(at) } catch {} }
  const server = net.createServer(sock => {
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('error', () => {})
    sock.on('data', async d => {
      buf += d
      if (buf.length > 4e6) return sock.destroy() // shortcut: one request is at most 4 MB of JSON; larger ones are cut off
      const n = buf.indexOf('\n')
      if (n < 0) return
      sock.pause()
      let reply
      try {
        const q = JSON.parse(buf.slice(0, n))
        const result = await handle(String(q.command ?? ''), q.args ?? {}, q.yes === true)
        reply = { ok: true, result: result === undefined ? null : result }
      } catch (e) { reply = { ok: false, error: e.message, ...(e.asks ? { asks: true } : {}) } }
      let line
      try { line = JSON.stringify(reply) } catch (e) { line = JSON.stringify({ ok: false, error: `The answer could not be sent: ${e.message}` }) }
      sock.end(line + '\n')
    })
  })
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(at, () => { if (process.platform !== 'win32') fs.chmodSync(at, 0o600); ok(server) })
  })
}

/** Asks the running Tetra at [at]: the parsed reply. */
function ask(at, command, args = {}, yes = false) {
  return new Promise((ok, fail) => {
    const sock = net.connect(at)
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('connect', () => sock.write(JSON.stringify({ command, args, yes }) + '\n'))
    sock.on('data', d => { buf += d })
    sock.on('end', () => { try { ok(JSON.parse(buf)) } catch { fail(new Error('Tetra did not answer.')) } })
    sock.on('error', e => fail(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? new Error('Tetra is not running (or its command line is off).') : e))
  })
}

module.exports = { APPS, COMMANDS: C, TAGS, manifest, find, forAi, aiApp, spec, coerce, argsFor, run, help, usage, socketPath, serve, ask }
