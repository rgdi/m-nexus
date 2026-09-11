import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_es.dart';
import 'app_localizations_pt.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es'),
    Locale('pt')
  ];

  /// Application title
  ///
  /// In en, this message translates to:
  /// **'M-NEXUS'**
  String get appTitle;

  /// No description provided for @navHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navHome;

  /// No description provided for @navDecks.
  ///
  /// In en, this message translates to:
  /// **'Decks'**
  String get navDecks;

  /// No description provided for @navNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get navNotes;

  /// No description provided for @navStats.
  ///
  /// In en, this message translates to:
  /// **'Stats'**
  String get navStats;

  /// No description provided for @navSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get navSettings;

  /// Greeting on home screen
  ///
  /// In en, this message translates to:
  /// **'Good {timeOfDay}, {name}'**
  String homeGreeting(String timeOfDay, String name);

  /// No description provided for @homeTodaysReview.
  ///
  /// In en, this message translates to:
  /// **'Today\'s review'**
  String get homeTodaysReview;

  /// No description provided for @homeCardsDue.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No cards due} =1{1 card due} other{{count} cards due}}'**
  String homeCardsDue(int count);

  /// No description provided for @homeEstimatedTime.
  ///
  /// In en, this message translates to:
  /// **'~{minutes} min estimated'**
  String homeEstimatedTime(int minutes);

  /// No description provided for @homeStartReview.
  ///
  /// In en, this message translates to:
  /// **'Start review'**
  String get homeStartReview;

  /// No description provided for @homeRecentNotes.
  ///
  /// In en, this message translates to:
  /// **'Recent notes'**
  String get homeRecentNotes;

  /// No description provided for @homeNoNotes.
  ///
  /// In en, this message translates to:
  /// **'No notes yet. Create your first note!'**
  String get homeNoNotes;

  /// No description provided for @reviewProgress.
  ///
  /// In en, this message translates to:
  /// **'{current} / {total}'**
  String reviewProgress(int current, int total);

  /// No description provided for @reviewAgain.
  ///
  /// In en, this message translates to:
  /// **'Again'**
  String get reviewAgain;

  /// No description provided for @reviewHard.
  ///
  /// In en, this message translates to:
  /// **'Hard'**
  String get reviewHard;

  /// No description provided for @reviewGood.
  ///
  /// In en, this message translates to:
  /// **'Good'**
  String get reviewGood;

  /// No description provided for @reviewEasy.
  ///
  /// In en, this message translates to:
  /// **'Easy'**
  String get reviewEasy;

  /// No description provided for @reviewShortcuts.
  ///
  /// In en, this message translates to:
  /// **'Shortcuts: Space to flip, 1/2/3/4 to rate'**
  String get reviewShortcuts;

  /// No description provided for @reviewAgainShort.
  ///
  /// In en, this message translates to:
  /// **'1'**
  String get reviewAgainShort;

  /// No description provided for @reviewHardShort.
  ///
  /// In en, this message translates to:
  /// **'2'**
  String get reviewHardShort;

  /// No description provided for @reviewGoodShort.
  ///
  /// In en, this message translates to:
  /// **'3'**
  String get reviewGoodShort;

  /// No description provided for @reviewEasyShort.
  ///
  /// In en, this message translates to:
  /// **'4'**
  String get reviewEasyShort;

  /// No description provided for @reviewTapToFlip.
  ///
  /// In en, this message translates to:
  /// **'👆 Tap to flip'**
  String get reviewTapToFlip;

  /// No description provided for @reviewQuestion.
  ///
  /// In en, this message translates to:
  /// **'Question'**
  String get reviewQuestion;

  /// No description provided for @reviewAnswer.
  ///
  /// In en, this message translates to:
  /// **'Answer'**
  String get reviewAnswer;

  /// No description provided for @reviewSummaryTitle.
  ///
  /// In en, this message translates to:
  /// **'Session complete!'**
  String get reviewSummaryTitle;

  /// No description provided for @reviewCardsReviewed.
  ///
  /// In en, this message translates to:
  /// **'You reviewed {count} cards'**
  String reviewCardsReviewed(int count);

  /// No description provided for @reviewAccuracy.
  ///
  /// In en, this message translates to:
  /// **'Accuracy: {percent}%'**
  String reviewAccuracy(int percent);

  /// No description provided for @reviewBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get reviewBack;

  /// No description provided for @deckAnatomy.
  ///
  /// In en, this message translates to:
  /// **'Anatomy'**
  String get deckAnatomy;

  /// No description provided for @deckPhysiology.
  ///
  /// In en, this message translates to:
  /// **'Physiology'**
  String get deckPhysiology;

  /// No description provided for @deckPharmacology.
  ///
  /// In en, this message translates to:
  /// **'Pharmacology'**
  String get deckPharmacology;

  /// No description provided for @deckPathology.
  ///
  /// In en, this message translates to:
  /// **'Pathology'**
  String get deckPathology;

  /// No description provided for @deckDefault.
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get deckDefault;

  /// No description provided for @deckCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No cards} =1{1 card} other{{count} cards}}'**
  String deckCount(int count);

  /// No description provided for @searchTitle.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get searchTitle;

  /// No description provided for @searchPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Search notes, cards, tags...'**
  String get searchPlaceholder;

  /// No description provided for @searchNoResults.
  ///
  /// In en, this message translates to:
  /// **'No results for \"{query}\"'**
  String searchNoResults(String query);

  /// No description provided for @searchResults.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No results} =1{1 result} other{{count} results}}'**
  String searchResults(int count);

  /// No description provided for @tagTitle.
  ///
  /// In en, this message translates to:
  /// **'Tag: {tag}'**
  String tagTitle(String tag);

  /// No description provided for @tagNoNotes.
  ///
  /// In en, this message translates to:
  /// **'No notes with this tag yet.'**
  String get tagNoNotes;

  /// No description provided for @graphTitle.
  ///
  /// In en, this message translates to:
  /// **'Knowledge graph'**
  String get graphTitle;

  /// No description provided for @graphNodes.
  ///
  /// In en, this message translates to:
  /// **'{count} notes'**
  String graphNodes(int count);

  /// No description provided for @graphEdges.
  ///
  /// In en, this message translates to:
  /// **'{count} links'**
  String graphEdges(int count);

  /// No description provided for @statsTitle.
  ///
  /// In en, this message translates to:
  /// **'Statistics'**
  String get statsTitle;

  /// No description provided for @statsCurrentStreak.
  ///
  /// In en, this message translates to:
  /// **'Current streak'**
  String get statsCurrentStreak;

  /// No description provided for @statsLongestStreak.
  ///
  /// In en, this message translates to:
  /// **'Longest streak'**
  String get statsLongestStreak;

  /// No description provided for @statsDays.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day} other{{count} days}}'**
  String statsDays(int count);

  /// No description provided for @statsTotalReviews.
  ///
  /// In en, this message translates to:
  /// **'Total reviews'**
  String get statsTotalReviews;

  /// No description provided for @statsRetentionRate.
  ///
  /// In en, this message translates to:
  /// **'Retention rate'**
  String get statsRetentionRate;

  /// No description provided for @statsNewCards.
  ///
  /// In en, this message translates to:
  /// **'New cards'**
  String get statsNewCards;

  /// No description provided for @statsLearningCards.
  ///
  /// In en, this message translates to:
  /// **'Learning'**
  String get statsLearningCards;

  /// No description provided for @statsReviewCards.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get statsReviewCards;

  /// No description provided for @statsMatureCards.
  ///
  /// In en, this message translates to:
  /// **'Mature'**
  String get statsMatureCards;

  /// No description provided for @statsTimeSpent.
  ///
  /// In en, this message translates to:
  /// **'Time spent'**
  String get statsTimeSpent;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// No description provided for @settingsLanguageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get settingsLanguageEnglish;

  /// No description provided for @settingsLanguageSpanish.
  ///
  /// In en, this message translates to:
  /// **'Español'**
  String get settingsLanguageSpanish;

  /// No description provided for @settingsLanguagePortuguese.
  ///
  /// In en, this message translates to:
  /// **'Português'**
  String get settingsLanguagePortuguese;

  /// No description provided for @settingsTheme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get settingsTheme;

  /// No description provided for @settingsThemeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsThemeSystem;

  /// No description provided for @settingsThemeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsThemeLight;

  /// No description provided for @settingsThemeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsThemeDark;

  /// No description provided for @settingsRetentionTarget.
  ///
  /// In en, this message translates to:
  /// **'Retention target'**
  String get settingsRetentionTarget;

  /// No description provided for @settingsRetentionHelp.
  ///
  /// In en, this message translates to:
  /// **'Higher = more reviews but better retention'**
  String get settingsRetentionHelp;

  /// No description provided for @settingsAbout.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get settingsAbout;

  /// No description provided for @settingsVersion.
  ///
  /// In en, this message translates to:
  /// **'Version'**
  String get settingsVersion;

  /// No description provided for @commonSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get commonSave;

  /// No description provided for @commonCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get commonCancel;

  /// No description provided for @commonDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get commonDelete;

  /// No description provided for @commonEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get commonEdit;

  /// No description provided for @commonClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get commonClose;

  /// No description provided for @commonOK.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get commonOK;

  /// No description provided for @commonYes.
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get commonYes;

  /// No description provided for @commonNo.
  ///
  /// In en, this message translates to:
  /// **'No'**
  String get commonNo;

  /// No description provided for @commonLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get commonLoading;

  /// No description provided for @commonError.
  ///
  /// In en, this message translates to:
  /// **'Error'**
  String get commonError;

  /// No description provided for @commonRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get commonRetry;

  /// No description provided for @voiceListening.
  ///
  /// In en, this message translates to:
  /// **'Listening...'**
  String get voiceListening;

  /// No description provided for @voiceProcessing.
  ///
  /// In en, this message translates to:
  /// **'Processing audio...'**
  String get voiceProcessing;

  /// No description provided for @voiceError.
  ///
  /// In en, this message translates to:
  /// **'Voice recognition error'**
  String get voiceError;

  /// No description provided for @voiceTapToStart.
  ///
  /// In en, this message translates to:
  /// **'Tap to record'**
  String get voiceTapToStart;

  /// No description provided for @voiceTapToStop.
  ///
  /// In en, this message translates to:
  /// **'Tap to stop'**
  String get voiceTapToStop;

  /// No description provided for @aiChatTitle.
  ///
  /// In en, this message translates to:
  /// **'AI Tutor'**
  String get aiChatTitle;

  /// No description provided for @aiChatPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Ask about your notes...'**
  String get aiChatPlaceholder;

  /// No description provided for @aiChatThinking.
  ///
  /// In en, this message translates to:
  /// **'Thinking...'**
  String get aiChatThinking;

  /// No description provided for @aiChatSources.
  ///
  /// In en, this message translates to:
  /// **'Sources'**
  String get aiChatSources;

  /// No description provided for @marketplaceTitle.
  ///
  /// In en, this message translates to:
  /// **'Marketplace'**
  String get marketplaceTitle;

  /// No description provided for @marketplaceInstall.
  ///
  /// In en, this message translates to:
  /// **'Install'**
  String get marketplaceInstall;

  /// No description provided for @marketplaceInstalled.
  ///
  /// In en, this message translates to:
  /// **'Installed'**
  String get marketplaceInstalled;

  /// No description provided for @marketplaceRating.
  ///
  /// In en, this message translates to:
  /// **'Rating'**
  String get marketplaceRating;

  /// No description provided for @marketplaceInstalls.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 install} other{{count} installs}}'**
  String marketplaceInstalls(int count);

  /// No description provided for @clozeEditorTitle.
  ///
  /// In en, this message translates to:
  /// **'Cloze editor'**
  String get clozeEditorTitle;

  /// No description provided for @clozeHint.
  ///
  /// In en, this message translates to:
  /// **'Wrap text with {syntax} to create a cloze'**
  String clozeHint(String syntax);

  /// No description provided for @clozeCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No clozes} =1{1 cloze} other{{count} clozes}}'**
  String clozeCount(int count);
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'es', 'pt'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
    case 'pt':
      return AppLocalizationsPt();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
