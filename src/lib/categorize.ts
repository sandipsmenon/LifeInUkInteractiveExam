/**
 * Rule-based, explainable categorisation. Every rule is a regular expression applied to a specific part of
 * the question so it is easy to see (and tweak) why a question landed in a category.
 * A question can belong to several categories. Manual category edits are stored separately and never
 * overwritten by re-running these rules.
 */

export interface CategorisableQuestion {
  prompt: string;
  options: { key: string; text: string }[];
  correctKeys: string[];
  explanation: string | null;
}

export const CATEGORY_SLUGS = [
  "dates",
  "numbers",
  "people",
  "monarchy",
  "history",
  "government",
  "geography",
  "law",
  "culture",
  "religion",
  "science",
  "values",
] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number] | "uncategorised";

const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b|\bAD\s?\d{2,4}\b|\b\d{1,3}(?:,\d{3})*\s+years ago\b|\bcentury\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+or\s+/i;
const NUMBERISH = /\d|%|£|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\b/i;

function correctText(q: CategorisableQuestion): string {
  return q.options.filter((o) => q.correctKeys.includes(o.key)).map((o) => o.text).join(" ");
}

// `all` = prompt + correct answer; `wide` also includes the explanation (used only where context helps).
type Rule = (ctx: { prompt: string; answer: string; options: string; all: string; wide: string }) => boolean;

const RULES: Record<Exclude<CategorySlug, "uncategorised">, Rule> = {
  dates: ({ prompt, answer }) =>
    /^\s*(when|in which (year|period|century)|what year|what date)\b/i.test(prompt) ||
    /\bwhat day\b/i.test(prompt) ||
    (YEAR.test(answer) && !/\bhow (many|much|old)\b/i.test(prompt)),
  numbers: ({ prompt, answer }) =>
    /\bhow (many|much|old)\b|\bpercentage\b|\bpopulation\b|\bminimum age\b|\bwhat age\b|\bhow long\b|\bwhat time\b/i.test(prompt) ||
    (/[%£]|\b\d+(\.\d+)?\s*(years? old|million|metres|miles|pm|am)\b|\bover \d+|\bunder \d+|\bless than\b/i.test(answer) &&
      NUMBERISH.test(answer)),
  people: ({ prompt, answer }) =>
    /^\s*who\b|\bwhich (british )?(sportsman|sportswoman|scientist|playwright|poet|author|writer|king|queen|person|inventor)\b/i.test(prompt) ||
    /\b(Sir|Dame|Lord|Lady|King|Queen|Prince|Princess)\s+[A-Z]/.test(answer),
  monarchy: ({ all }) =>
    /\b(king|queen|monarch|monarchy|reign|reigning|royal|throne|crown(?! court)|prince|princess|consort|tudor|stuart)\b|\b(Henry|Edward|Elizabeth|James|Charles|William|Victoria|Mary|Richard|George|Anne)\s+(I{1,3}|IV|V|VI{0,3}|the)\b/i.test(all),
  history: ({ wide, prompt }) =>
    /\b(stone age|bronze age|iron age|roman|romans|viking|vikings|anglo-saxons?|normans?|black death|wars? of the roses|magna carta|enlightenment|industrial revolution|glorious revolution|civil war|first world war|second world war|world war|battle|invaded|invasion|medieval|middle ages|elizabethan|reformation|empire|prehistoric|archaeolog|gentry|peasants|century|swinging sixties|president|nightingale|thatcher)\b/i.test(wide) ||
    /^\s*when did\b/i.test(prompt),
  government: ({ all }) =>
    /\b(parliament|government|prime minister|minister|chancellor|exchequer|election|elected|vote|voting|mps?|msps?|coalition|referendum|constitution|constitutional|cabinet|house of commons|house of lords|westminster|holyrood|senedd|stormont|commonwealth|european union|\beu\b|nato|north atlantic treaty|united nations|civil servants?|public office|political part(y|ies)|downing street|chequers|assembly|mayor|council|speaker|conservative|labour|tories|whigs|opposition|peers?)\b/i.test(all),
  geography: ({ prompt, wide }) =>
    /^\s*where\b|\blocated\b|\bcapital (city )?of\b|\bwhich (scottish|welsh|english|irish|british)? ?(city|town|country|county|island)\b/i.test(prompt) ||
    /\b(national park|loch|river|island|isle of|orkney|channel|population|four parts of the uk|great britain|territor(y|ies))\b/i.test(wide),
  law: ({ all }) =>
    /\b(court|courts|law|laws|legal|illegal|crime|criminal|police|jury|judge|magistrates?|sheriff|claims?|fine|fined|licence|discrimination|fair trial|rights?|freedom|citizen|citizenship|permanent resident|responsibilit(y|ies)|minimum age|stand for public office|offences?|dogs?|collar|driving|register(ed)?|national insurance)\b/i.test(all),
  culture: ({ all }) =>
    /\b(tradition(al)?|sport|sports|sportsman|sportswoman|olympic|olympians?|golf|football|rugby|cricket|tennis|rowing|sail(ed|ing)?|yachtswoman|running|poet|poetry|poem|plays?|playwright|drama|novel|author|literature|bard|film|films|studios|music|musical|opera|operas|album|art|gallery|galleries|museum|pubs?|darts|pool|food|cakes?|dish|snack|flag|flower|rose|thistle|daffodil|shamrock|landmark|london eye|big ben|clock|jokes?|april fool|remembrance|cenotaph|tv|television|pantomimes?|social networking|painter|artist|portrait|movies?|booker|languages?|dialects?|accents?|festival)\b/i.test(all),
  religion: ({ all }) =>
    /\b(church|churches|christian|christians|christmas|easter|lent|ash wednesday|shrove|hanukkah|diwali|eid|vaisakhi|archbishop|bishops?|pope|patron saint|saint|religion|religious|faith|faiths|anglican|episcopal|jewish|muslim|hindu|sikh|spiritual)\b/i.test(all),
  science: ({ all }) =>
    /\b(invent(ed|or|ion)?|scientist|nobel|dna|discover(ed|y)?|world wide web|engineer|jet engine|penicillin|newton|cloning|telescope|mri|concorde|aircraft|nursing|insulin)\b/i.test(all),
  values: ({ all }) =>
    /\b(fundamental principles?|british (life|values)|charit(y|ies)|volunteers?|community|tolerance|democracy|rule of law|individual liberty|autocracy)\b/i.test(all),
};

export function categorise(q: CategorisableQuestion): CategorySlug[] {
  const answer = correctText(q);
  const ctx = {
    prompt: q.prompt,
    answer,
    options: q.options.map((o) => o.text).join(" | "),
    all: [q.prompt, answer].join(" \n "),
    wide: [q.prompt, answer, q.explanation ?? ""].join(" \n "),
  };
  const result = CATEGORY_SLUGS.filter((slug) => RULES[slug](ctx));
  return result.length ? result : ["uncategorised"];
}

/** Finer-grained topic tags; useful for search and for grouping easily confused facts. */
const TOPICS: [string, RegExp][] = [
  ["Prehistoric Britain", /\b(stone age|bronze age|iron age|skara brae|stonehenge|hunter-gatherers|prehistoric)\b/i],
  ["Romans & invasions", /\b(romans?|anglo-saxons?|jutes|angles|saxons|vikings?|normans?|invaded)\b/i],
  ["Black Death", /\bblack death\b/i],
  ["Wars of the Roses", /\bwars of the roses\b|\bbosworth\b/i],
  ["Tudors", /\b(henry viii|henry vii|elizabeth i|tudors?|elizabethan)\b/i],
  ["Magna Carta", /\bmagna carta\b/i],
  ["The Enlightenment", /\benlightenment\b/i],
  ["World wars", /\b(first|second) world war\b/i],
  ["European Union", /\beuropean union\b|\beuro\b/i],
  ["Commonwealth & NATO", /\b(commonwealth|nato|north atlantic treaty)\b/i],
  ["UK Parliament", /\b(palace of westminster|house of commons|house of lords|mps?)\b/i],
  ["Devolved governments", /\b(scottish parliament|msps?|holyrood|senedd|stormont|welsh (parliament|assembly)|northern ireland assembly)\b/i],
  ["Prime Minister & Cabinet", /\b(prime minister|chancellor|cabinet|downing street|chequers)\b/i],
  ["Monarch & constitution", /\b(constitutional monarchy|monarch|king of the united kingdom|queen consort)\b/i],
  ["Elections & voting", /\b(election|elected|vote|voting|coalition|referendum|public office)\b/i],
  ["Courts & justice", /\b(court|courts|magistrates?|jury|judge|small claims|sheriff)\b/i],
  ["Rights & citizenship", /\b(freedom|fair trial|discrimination|citizen|permanent resident|rights?)\b/i],
  ["Licences, fines & age limits", /\b(licence|fined?|minimum age|age requirement)\b/i],
  ["Church of England", /\b(church of england|archbishop|anglican|episcopal)\b/i],
  ["Festivals & special days", /\b(christmas|easter|lent|ash wednesday|shrove|hanukkah|diwali|eid|vaisakhi|april fool|remembrance|halloween|valentine)\b/i],
  ["Patron saints, flags & symbols", /\b(patron saint|cross of st|flag|flower|rose|thistle|daffodil|shamrock)\b/i],
  ["Olympians & sport", /\b(olympic|olympians?|golf|rowing|sail(ed)?|yachtswoman|medals?)\b/i],
  ["Literature & poetry", /\b(poet|poetry|poems?|playwright|shakespeare|burns|bard|novel)\b/i],
  ["Music, theatre & film", /\b(opera|operas|gilbert and sullivan|music|album|mercury|film|studios)\b/i],
  ["Food, drink & pubs", /\b(pubs?|cakes?|food|drink|darts|wine|beer)\b/i],
  ["Landmarks & galleries", /\b(london eye|big ben|cenotaph|gallery|galleries|tate|museum|national trust)\b/i],
  ["Places & national parks", /\b(national park|loch|swansea|belfast|st andrews|cardiff|edinburgh|thames)\b/i],
  ["Population", /\bpopulation\b/i],
  ["Charities & volunteering", /\b(charit(y|ies)|national trust|friends of the earth|volunteers?)\b/i],
  ["Inventors & scientists", /\b(invent(or|ed)|scientist|nobel|dna|world wide web|newton)\b/i],
  ["British values", /\b(fundamental principles?|tolerance|rule of law|democracy|autocracy)\b/i],
];

export function deriveTopics(q: CategorisableQuestion): string[] {
  const text = [q.prompt, correctText(q), q.explanation ?? ""].join(" \n ");
  return TOPICS.filter(([, re]) => re.test(text)).map(([name]) => name);
}
