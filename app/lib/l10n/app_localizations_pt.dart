// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Portuguese (`pt`).
class AppLocalizationsPt extends AppLocalizations {
  AppLocalizationsPt([String locale = 'pt']) : super(locale);

  @override
  String get appTitle => 'M-NEXUS';

  @override
  String get navHome => 'Início';

  @override
  String get navDecks => 'Baralhos';

  @override
  String get navNotes => 'Notas';

  @override
  String get navStats => 'Estatísticas';

  @override
  String get navSettings => 'Configurações';

  @override
  String homeGreeting(String timeOfDay, String name) {
    return 'Bom(a) $timeOfDay, $name';
  }

  @override
  String get homeTodaysReview => 'Revisão de hoje';

  @override
  String homeCardsDue(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cartões pendentes',
      one: '1 cartão pendente',
      zero: 'Sem cartões pendentes',
    );
    return '$_temp0';
  }

  @override
  String homeEstimatedTime(int minutes) {
    return '~$minutes min estimados';
  }

  @override
  String get homeStartReview => 'Começar revisão';

  @override
  String get homeRecentNotes => 'Notas recentes';

  @override
  String get homeNoNotes => 'Ainda não há notas. Crie sua primeira nota!';

  @override
  String reviewProgress(int current, int total) {
    return '$current / $total';
  }

  @override
  String get reviewAgain => 'De novo';

  @override
  String get reviewHard => 'Difícil';

  @override
  String get reviewGood => 'Bom';

  @override
  String get reviewEasy => 'Fácil';

  @override
  String get reviewShortcuts =>
      'Atalhos: Espaço para virar, 1/2/3/4 para classificar';

  @override
  String get reviewAgainShort => '1';

  @override
  String get reviewHardShort => '2';

  @override
  String get reviewGoodShort => '3';

  @override
  String get reviewEasyShort => '4';

  @override
  String get reviewTapToFlip => '👆 Toque para virar';

  @override
  String get reviewQuestion => 'Pergunta';

  @override
  String get reviewAnswer => 'Resposta';

  @override
  String get reviewSummaryTitle => 'Sessão completa!';

  @override
  String reviewCardsReviewed(int count) {
    return 'Você revisou $count cartões';
  }

  @override
  String reviewAccuracy(int percent) {
    return 'Precisão: $percent%';
  }

  @override
  String get reviewBack => 'Voltar';

  @override
  String get deckAnatomy => 'Anatomia';

  @override
  String get deckPhysiology => 'Fisiologia';

  @override
  String get deckPharmacology => 'Farmacologia';

  @override
  String get deckPathology => 'Patologia';

  @override
  String get deckDefault => 'Padrão';

  @override
  String deckCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cartões',
      one: '1 cartão',
      zero: 'Sem cartões',
    );
    return '$_temp0';
  }

  @override
  String get searchTitle => 'Buscar';

  @override
  String get searchPlaceholder => 'Buscar notas, cartões, tags...';

  @override
  String searchNoResults(String query) {
    return 'Sem resultados para \"$query\"';
  }

  @override
  String searchResults(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count resultados',
      one: '1 resultado',
      zero: 'Sem resultados',
    );
    return '$_temp0';
  }

  @override
  String tagTitle(String tag) {
    return 'Tag: $tag';
  }

  @override
  String get tagNoNotes => 'Ainda não há notas com esta tag.';

  @override
  String get graphTitle => 'Grafo de conhecimento';

  @override
  String graphNodes(int count) {
    return '$count notas';
  }

  @override
  String graphEdges(int count) {
    return '$count links';
  }

  @override
  String get statsTitle => 'Estatísticas';

  @override
  String get statsCurrentStreak => 'Sequência atual';

  @override
  String get statsLongestStreak => 'Maior sequência';

  @override
  String statsDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count dias',
      one: '1 dia',
    );
    return '$_temp0';
  }

  @override
  String get statsTotalReviews => 'Total de revisões';

  @override
  String get statsRetentionRate => 'Taxa de retenção';

  @override
  String get statsNewCards => 'Cartões novos';

  @override
  String get statsLearningCards => 'Aprendendo';

  @override
  String get statsReviewCards => 'Revisão';

  @override
  String get statsMatureCards => 'Maduros';

  @override
  String get statsTimeSpent => 'Tempo estudado';

  @override
  String get settingsTitle => 'Configurações';

  @override
  String get settingsLanguage => 'Idioma';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsLanguageSpanish => 'Español';

  @override
  String get settingsLanguagePortuguese => 'Português';

  @override
  String get settingsTheme => 'Tema';

  @override
  String get settingsThemeSystem => 'Sistema';

  @override
  String get settingsThemeLight => 'Claro';

  @override
  String get settingsThemeDark => 'Escuro';

  @override
  String get settingsRetentionTarget => 'Meta de retenção';

  @override
  String get settingsRetentionHelp =>
      'Maior = mais revisões mas melhor retenção';

  @override
  String get settingsAbout => 'Sobre';

  @override
  String get settingsVersion => 'Versão';

  @override
  String get commonSave => 'Salvar';

  @override
  String get commonCancel => 'Cancelar';

  @override
  String get commonDelete => 'Excluir';

  @override
  String get commonEdit => 'Editar';

  @override
  String get commonClose => 'Fechar';

  @override
  String get commonOK => 'OK';

  @override
  String get commonYes => 'Sim';

  @override
  String get commonNo => 'Não';

  @override
  String get commonLoading => 'Carregando...';

  @override
  String get commonError => 'Erro';

  @override
  String get commonRetry => 'Tentar novamente';

  @override
  String get voiceListening => 'Ouvindo...';

  @override
  String get voiceProcessing => 'Processando áudio...';

  @override
  String get voiceError => 'Erro de reconhecimento de voz';

  @override
  String get voiceTapToStart => 'Toque para gravar';

  @override
  String get voiceTapToStop => 'Toque para parar';

  @override
  String get aiChatTitle => 'Tutor IA';

  @override
  String get aiChatPlaceholder => 'Pergunte sobre suas notas...';

  @override
  String get aiChatThinking => 'Pensando...';

  @override
  String get aiChatSources => 'Fontes';

  @override
  String get marketplaceTitle => 'Marketplace';

  @override
  String get marketplaceInstall => 'Instalar';

  @override
  String get marketplaceInstalled => 'Instalado';

  @override
  String get marketplaceRating => 'Avaliação';

  @override
  String marketplaceInstalls(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count instalações',
      one: '1 instalação',
    );
    return '$_temp0';
  }

  @override
  String get clozeEditorTitle => 'Editor de cloze';

  @override
  String clozeHint(String syntax) {
    return 'Envolva o texto com $syntax para criar um cloze';
  }

  @override
  String clozeCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count clozes',
      one: '1 cloze',
      zero: 'Sem clozes',
    );
    return '$_temp0';
  }
}
