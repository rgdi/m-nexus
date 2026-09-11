// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'M-NEXUS';

  @override
  String get navHome => 'Home';

  @override
  String get navDecks => 'Decks';

  @override
  String get navNotes => 'Notes';

  @override
  String get navStats => 'Stats';

  @override
  String get navSettings => 'Settings';

  @override
  String homeGreeting(String timeOfDay, String name) {
    return 'Good $timeOfDay, $name';
  }

  @override
  String get homeTodaysReview => 'Today\'s review';

  @override
  String homeCardsDue(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cards due',
      one: '1 card due',
      zero: 'No cards due',
    );
    return '$_temp0';
  }

  @override
  String homeEstimatedTime(int minutes) {
    return '~$minutes min estimated';
  }

  @override
  String get homeStartReview => 'Start review';

  @override
  String get homeRecentNotes => 'Recent notes';

  @override
  String get homeNoNotes => 'No notes yet. Create your first note!';

  @override
  String reviewProgress(int current, int total) {
    return '$current / $total';
  }

  @override
  String get reviewAgain => 'Again';

  @override
  String get reviewHard => 'Hard';

  @override
  String get reviewGood => 'Good';

  @override
  String get reviewEasy => 'Easy';

  @override
  String get reviewShortcuts => 'Shortcuts: Space to flip, 1/2/3/4 to rate';

  @override
  String get reviewAgainShort => '1';

  @override
  String get reviewHardShort => '2';

  @override
  String get reviewGoodShort => '3';

  @override
  String get reviewEasyShort => '4';

  @override
  String get reviewTapToFlip => '👆 Tap to flip';

  @override
  String get reviewQuestion => 'Question';

  @override
  String get reviewAnswer => 'Answer';

  @override
  String get reviewSummaryTitle => 'Session complete!';

  @override
  String reviewCardsReviewed(int count) {
    return 'You reviewed $count cards';
  }

  @override
  String reviewAccuracy(int percent) {
    return 'Accuracy: $percent%';
  }

  @override
  String get reviewBack => 'Back';

  @override
  String get deckAnatomy => 'Anatomy';

  @override
  String get deckPhysiology => 'Physiology';

  @override
  String get deckPharmacology => 'Pharmacology';

  @override
  String get deckPathology => 'Pathology';

  @override
  String get deckDefault => 'Default';

  @override
  String deckCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cards',
      one: '1 card',
      zero: 'No cards',
    );
    return '$_temp0';
  }

  @override
  String get searchTitle => 'Search';

  @override
  String get searchPlaceholder => 'Search notes, cards, tags...';

  @override
  String searchNoResults(String query) {
    return 'No results for \"$query\"';
  }

  @override
  String searchResults(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count results',
      one: '1 result',
      zero: 'No results',
    );
    return '$_temp0';
  }

  @override
  String tagTitle(String tag) {
    return 'Tag: $tag';
  }

  @override
  String get tagNoNotes => 'No notes with this tag yet.';

  @override
  String get graphTitle => 'Knowledge graph';

  @override
  String graphNodes(int count) {
    return '$count notes';
  }

  @override
  String graphEdges(int count) {
    return '$count links';
  }

  @override
  String get statsTitle => 'Statistics';

  @override
  String get statsCurrentStreak => 'Current streak';

  @override
  String get statsLongestStreak => 'Longest streak';

  @override
  String statsDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count days',
      one: '1 day',
    );
    return '$_temp0';
  }

  @override
  String get statsTotalReviews => 'Total reviews';

  @override
  String get statsRetentionRate => 'Retention rate';

  @override
  String get statsNewCards => 'New cards';

  @override
  String get statsLearningCards => 'Learning';

  @override
  String get statsReviewCards => 'Review';

  @override
  String get statsMatureCards => 'Mature';

  @override
  String get statsTimeSpent => 'Time spent';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsLanguage => 'Language';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsLanguageSpanish => 'Español';

  @override
  String get settingsLanguagePortuguese => 'Português';

  @override
  String get settingsTheme => 'Theme';

  @override
  String get settingsThemeSystem => 'System';

  @override
  String get settingsThemeLight => 'Light';

  @override
  String get settingsThemeDark => 'Dark';

  @override
  String get settingsRetentionTarget => 'Retention target';

  @override
  String get settingsRetentionHelp =>
      'Higher = more reviews but better retention';

  @override
  String get settingsAbout => 'About';

  @override
  String get settingsVersion => 'Version';

  @override
  String get commonSave => 'Save';

  @override
  String get commonCancel => 'Cancel';

  @override
  String get commonDelete => 'Delete';

  @override
  String get commonEdit => 'Edit';

  @override
  String get commonClose => 'Close';

  @override
  String get commonOK => 'OK';

  @override
  String get commonYes => 'Yes';

  @override
  String get commonNo => 'No';

  @override
  String get commonLoading => 'Loading...';

  @override
  String get commonError => 'Error';

  @override
  String get commonRetry => 'Retry';

  @override
  String get voiceListening => 'Listening...';

  @override
  String get voiceProcessing => 'Processing audio...';

  @override
  String get voiceError => 'Voice recognition error';

  @override
  String get voiceTapToStart => 'Tap to record';

  @override
  String get voiceTapToStop => 'Tap to stop';

  @override
  String get aiChatTitle => 'AI Tutor';

  @override
  String get aiChatPlaceholder => 'Ask about your notes...';

  @override
  String get aiChatThinking => 'Thinking...';

  @override
  String get aiChatSources => 'Sources';

  @override
  String get marketplaceTitle => 'Marketplace';

  @override
  String get marketplaceInstall => 'Install';

  @override
  String get marketplaceInstalled => 'Installed';

  @override
  String get marketplaceRating => 'Rating';

  @override
  String marketplaceInstalls(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count installs',
      one: '1 install',
    );
    return '$_temp0';
  }

  @override
  String get clozeEditorTitle => 'Cloze editor';

  @override
  String clozeHint(String syntax) {
    return 'Wrap text with $syntax to create a cloze';
  }

  @override
  String clozeCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count clozes',
      one: '1 cloze',
      zero: 'No clozes',
    );
    return '$_temp0';
  }
}
