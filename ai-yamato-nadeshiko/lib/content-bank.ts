// 投稿本文の素材。ネットワークもLLMも使わずローカルで組み立てる。
// 文体ルールは 事業Vault/01_CHARACTER/ENGLISH_STYLE.md が唯一の正。
//   - 短い文を並べる / 誇張しない / 実体験（I used, I visited 等）は書かない
//   - トピックは1件につき1投稿しか使わない（使い回しを構造的に不可能にする）

export type Outfit = "KIMONO" | "YUKATA" | "MODERN" | "NONE";
export type Background =
  | "SHRINE"
  | "GARDEN"
  | "TEAROOM"
  | "STREET"
  | "CAFE"
  | "ENGAWA"
  | "TRAIN"
  | "MARKET"
  | "RIVER"
  | "HOME"
  | "NONE";

export type TopicEntry = {
  key: string;
  /** 情景を1文。集客型の1行目 */
  scene: string;
  /** 文化的な意味を1〜2文 */
  meaning: string;
  /** 静かな問いかけ */
  question: string;
  /** 感想・むずかしさ。関係づくり型の1行目（実体験の主張にしない） */
  feeling: string;
  outfit: Outfit;
  background: Background;
};

export type AffiliateEntry = {
  key: string;
  /** offers.category に対応。DBに該当案件があれば AFFILIATE 属性へ入れる */
  offerCategory: "VPN" | "ESIM" | "JAPAN_TRAVEL";
  /** 数字を含めない。価格・実測値を書くには claims 行（source_url + checked_at）が要る */
  facts: string[];
  closing: string;
};

// ---------------------------------------------------------------------------
// カテゴリ別トピック（30日検証設計 §2 の本数と1対1で対応させる）
// ---------------------------------------------------------------------------

const KIMONO: TopicEntry[] = [
  {
    key: "kimono_hatsumode",
    scene: "At the first shrine visit of the year, many people wear kimono.",
    meaning:
      "The first shrine visit of the year is called hatsumode. People go in the first days of January and write a wish on a small wooden plate.",
    question: "What do people do on the first day of the year in your country?",
    feeling: "January is cold. But the shrine is warm with people, and that is a strange comfort.",
    outfit: "KIMONO",
    background: "SHRINE",
  },
  {
    key: "kimono_komon",
    scene: "This kimono has a very small pattern, repeated everywhere.",
    meaning:
      'A kimono with a small pattern repeated all over is called "komon". Because the pattern has no direction, komon is treated as everyday wear, not formal wear.',
    question: "Do you have clothes where the pattern decides the occasion?",
    feeling: "The rule is not about price. It is about the pattern. That took me a long time to understand.",
    outfit: "KIMONO",
    background: "STREET",
  },
  {
    key: "kimono_obi_knot",
    scene: "The belt on a kimono is called an obi, and the knot is tied at the back.",
    meaning:
      "There are many knots, and the choice tells other people the mood of the day. A flat knot is quiet. A shaped knot is for a celebration.",
    question: "Is there something in your clothing that quietly says the occasion?",
    feeling: "Tying an obi alone is difficult. The hands must work behind the back, without eyes.",
    outfit: "KIMONO",
    background: "TEAROOM",
  },
  {
    key: "kimono_colors",
    scene: "The colors here are indigo, warbler green, persimmon, and iron blue.",
    meaning:
      "Old Japanese color names come from plants, birds, and fruit. The name carries the season with it.",
    question: "Are the color names in your language also borrowed from nature?",
    feeling: "When a color has the name of a bird, it is hard to translate. Something is lost in English.",
    outfit: "KIMONO",
    background: "GARDEN",
  },
  {
    key: "kimono_tearoom",
    scene: "In a tea room, the entrance is low. Everyone must bend to enter.",
    meaning:
      "The low door is intentional. Inside the room, rank from outside is not carried in. Everyone enters the same way.",
    question: "Does your culture have a place where status is left at the door?",
    feeling: "A quiet room can feel stricter than a loud one. The silence has rules.",
    outfit: "KIMONO",
    background: "TEAROOM",
  },
  {
    key: "kimono_garden_walk",
    scene: "A Japanese garden is built to be walked slowly, not seen at once.",
    meaning:
      "The path bends so the whole garden is never visible from one point. What is hidden is part of the design.",
    question: "Do you prefer a view all at once, or a little at a time?",
    feeling: "Walking slowly is harder than it sounds. The feet want to hurry.",
    outfit: "KIMONO",
    background: "GARDEN",
  },
  {
    key: "kimono_sleeve",
    scene: "Some kimono have very long sleeves, almost to the ankle.",
    meaning:
      "Long sleeves are called furisode and are worn by young unmarried women, mostly at ceremonies. Shorter sleeves are for everyday and for other ages.",
    question: "Does clothing in your country mark a stage of life?",
    feeling: "Clothes that say your age out loud feel gentle and strict at the same time.",
    outfit: "KIMONO",
    background: "SHRINE",
  },
  {
    key: "kimono_geta_sound",
    scene: "Wooden sandals make a dry sound on stone.",
    meaning:
      "The sandals are called geta. In summer evenings the sound arrives before the person does.",
    question: "Is there a sound that means summer where you live?",
    feeling: "The sound is small. Still, it is the part of the season I want to record most.",
    outfit: "KIMONO",
    background: "STREET",
  },
  {
    key: "kimono_folding",
    scene: "A kimono is folded flat, into a rectangle, with no curves.",
    meaning:
      "A kimono is cut from straight lines only, so it returns to a flat shape. That is why it can be stored in a shallow drawer.",
    question: "What do you own that was designed to be stored, not displayed?",
    feeling: "Folding it correctly is like solving a small puzzle that someone solved centuries ago.",
    outfit: "KIMONO",
    background: "HOME",
  },
  {
    key: "kimono_rain_day",
    scene: "On rainy days, a cloth cover is put over the kimono.",
    meaning:
      "Silk marks easily with water, so rain changes the plan for the day. A paper umbrella is often carried as well.",
    question: "Does rain change what you wear, or only how you feel?",
    feeling: "Rain makes the colors darker and the street quieter. I like that version of the city.",
    outfit: "KIMONO",
    background: "STREET",
  },
];

const YUKATA: TopicEntry[] = [
  {
    key: "yukata_matsuri",
    scene: "At a summer festival, the street fills with cotton yukata.",
    meaning:
      "A yukata is lighter than a kimono and has no lining. It belongs to heat, evenings, and festivals.",
    question: "What do people wear for a summer festival in your country?",
    feeling: "A festival is loud, but the walk home is very quiet. That gap stays with me.",
    outfit: "YUKATA",
    background: "STREET",
  },
  {
    key: "yukata_hanabi",
    scene: "Fireworks in Japan are watched sitting down, from a riverbank.",
    meaning:
      "The show is long and slow, with pauses. People bring food and stay for the whole evening.",
    question: "Are fireworks a short event or a long one where you live?",
    feeling: "The pause between two fireworks feels longer than it is.",
    outfit: "YUKATA",
    background: "RIVER",
  },
  {
    key: "yukata_engawa",
    scene: "A wooden strip runs along the outside of an old house, under the roof.",
    meaning:
      'The wooden strip along the outside of an old house is called "engawa". It is neither inside nor outside, and in summer people sit there in the evening.',
    question: "Does your home have a place that is between inside and outside?",
    feeling: "A space with no clear name is often the most used space.",
    outfit: "YUKATA",
    background: "ENGAWA",
  },
  {
    key: "yukata_aizome",
    scene: "The deep blue of this cloth comes from a plant, not a machine.",
    meaning:
      "Indigo dyeing is done many times, and the color deepens with each bath. Old work clothes were dyed this way.",
    question: "Is there a color in your country that came from one plant?",
    feeling: "The blue is never exactly the same twice. That is the point, but it is also inconvenient.",
    outfit: "YUKATA",
    background: "HOME",
  },
  {
    key: "yukata_ryokan",
    scene: "In a traditional inn, a yukata is prepared in the room for every guest.",
    meaning:
      "A yukata at an inn is worn inside the building, and in some hot spring towns it is worn on the street as well.",
    question: "Do hotels in your country give guests something to wear?",
    feeling: "Wearing the same thing as everyone else in the town is oddly relaxing.",
    outfit: "YUKATA",
    background: "HOME",
  },
  {
    key: "yukata_geta_first",
    scene: "The sandals worn with a yukata have no soft part at all.",
    meaning:
      "The strap sits between the toes, so the walk becomes shorter and slower. New sandals are hard for the first hour.",
    question: "What shoes in your culture must be broken in?",
    feeling: "Beautiful things are not always comfortable. Both can be true.",
    outfit: "YUKATA",
    background: "STREET",
  },
  {
    key: "yukata_uchiwa",
    scene: "A flat round fan is often carried in the back of the belt.",
    meaning:
      'A flat round fan is called "uchiwa", and it does not fold. Shops give them away in summer, printed with their name.',
    question: "What object in your country is given away in one season only?",
    feeling: "A free paper fan is a small thing. Summer would feel incomplete without it.",
    outfit: "YUKATA",
    background: "STREET",
  },
  {
    key: "yukata_bon_odori",
    scene: "In mid August, people dance in a circle around a wooden tower.",
    meaning:
      "The dance is called bon odori. The steps repeat, so anyone can join after watching for a while.",
    question: "Is there a dance in your country that a stranger can join?",
    feeling: "A dance that is easy on purpose is a kind of hospitality.",
    outfit: "YUKATA",
    background: "STREET",
  },
];

const CULTURE: TopicEntry[] = [
  {
    key: "culture_furin",
    scene: "A small glass bell is hung by the window in summer.",
    meaning:
      'A small glass bell hung by the window is called "furin". The sound is meant to make people feel cool, even when the air is hot.',
    question: "Do you have something like this in your country?",
    feeling: "A sound cannot lower the temperature. Somehow it still works.",
    outfit: "MODERN",
    background: "ENGAWA",
  },
  {
    key: "culture_hanami",
    scene: "In spring, people sit under the cherry trees and eat there.",
    meaning:
      "Sitting under the cherry trees in spring is called hanami. The flowers last about one week, so the plan is decided by the tree, not by the calendar.",
    question: "Is there a plant that decides a season in your country?",
    feeling: "Waiting for one week of flowers every year is not efficient. That is why I like it.",
    outfit: "MODERN",
    background: "GARDEN",
  },
  {
    key: "culture_tsukimi",
    scene: "In autumn, rice dumplings are placed by the window for the moon.",
    meaning:
      "Placing rice dumplings by the window in autumn is called tsukimi, moon viewing. Grass called susuki is put beside them, for the harvest.",
    question: "Does the moon have a season in your language?",
    feeling: "Looking at the moon on purpose is different from noticing it by accident.",
    outfit: "MODERN",
    background: "ENGAWA",
  },
  {
    key: "culture_omamori",
    scene: "Small cloth bags are sold at shrines, each closed with a string.",
    meaning:
      'The small cloth bags sold at shrines are called "omamori". They are not opened. Each one is for one thing: study, travel, health.',
    question: "Do you carry something for luck?",
    feeling: "A bag that must never be opened is a strange kind of promise.",
    outfit: "KIMONO",
    background: "SHRINE",
  },
  {
    key: "culture_shodo",
    scene: "In calligraphy, the brush cannot go back over a line.",
    meaning:
      "The ink soaks into the paper at once, so a correction is visible forever. The speed of the hand stays in the stroke.",
    question: "What do you do that cannot be undone?",
    feeling: "Writing without the option to fix it makes my hand slower and my breath shorter.",
    outfit: "KIMONO",
    background: "TEAROOM",
  },
  {
    key: "culture_haiku",
    scene: "A haiku is only seventeen syllables.",
    meaning:
      "That is not much space for a feeling, so a season word is used to carry the rest of the meaning.",
    question: "Which is harder to say in a short form, happiness or loneliness?",
    feeling: "Short forms are not easier. Every word has to earn its place.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "culture_wabisabi",
    scene: "A cracked bowl is sometimes repaired with gold, and the repair is left visible.",
    meaning:
      '"Wabi-sabi" is finding beauty in things that are not perfect. The repair becomes part of the object, not a secret.',
    question: "Do you keep something that is broken and repaired?",
    feeling: "Hiding a repair is normal. Showing it takes a different kind of confidence.",
    outfit: "KIMONO",
    background: "TEAROOM",
  },
  {
    key: "culture_ikebana",
    scene: "In Japanese flower arrangement, empty space is arranged too.",
    meaning:
      "The stems, the space, and the container are treated as one shape. Fewer flowers are often used, not more.",
    question: "In your country, does a gift of flowers mean many, or few?",
    feeling: "Deciding what to remove is harder than deciding what to add.",
    outfit: "KIMONO",
    background: "TEAROOM",
  },
  {
    key: "culture_onsen_manner",
    scene: "At a hot spring, the body is washed completely before entering the water.",
    meaning:
      "The bath is for warming, not for washing. The water is shared, so it is kept clean by everyone.",
    question: "Are there shared places in your country with unwritten rules?",
    feeling: "Rules that nobody writes down are the hardest ones to learn as a visitor.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "culture_shoji",
    scene: "Paper doors do not block light. They spread it.",
    meaning:
      "The paper is called shoji. The room stays bright without a direct beam, and the shape of the garden appears as a shadow.",
    question: "How does light enter your home in the morning?",
    feeling: "Soft light makes a small room feel less closed.",
    outfit: "KIMONO",
    background: "HOME",
  },
  {
    key: "culture_toshikoshi_soba",
    scene: "On the last night of the year, many families eat buckwheat noodles.",
    meaning:
      "The noodles are long and cut easily. One explanation is a wish to cut off the troubles of the old year.",
    question: "Is there a food you must eat on one specific night?",
    feeling: "Eating the same thing every year is a quiet way of counting time.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "culture_tanabata",
    scene: "In July, paper strips with wishes are tied to bamboo.",
    meaning:
      "The festival is called tanabata. It comes from a story about two stars that meet once a year.",
    question: "Does your country have a festival that comes from the sky?",
    feeling: "Writing a wish where other people can read it changes what you write.",
    outfit: "YUKATA",
    background: "STREET",
  },
  {
    key: "culture_setsubun",
    scene: "In February, roasted beans are thrown at the door.",
    meaning:
      "Throwing roasted beans in February is called setsubun, and it marks the day before the old spring. The beans send bad luck out and invite good luck in.",
    question: "What does your country throw away at the start of a season?",
    feeling: "Cleaning up the beans afterwards is not in the story, but it is part of the day.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "culture_furoshiki",
    scene: "A square cloth can be tied into a bag, and untied back into a cloth.",
    meaning:
      "A square cloth used for carrying things is called furoshiki. The same cloth can carry a box, a bottle, or nothing at all.",
    question: "Is there one object in your home that has many shapes?",
    feeling: "An object that becomes flat again when it is not needed feels very modern to me.",
    outfit: "MODERN",
    background: "HOME",
  },
];

const FOOD: TopicEntry[] = [
  {
    key: "food_nerikiri",
    scene: "This sweet is shaped like a flower of the current month.",
    meaning:
      'A sweet shaped by hand to match the month is called "nerikiri". The shape changes with the season, so the same shop sells a different sweet in spring and autumn.',
    question: "Does a shop near you change its products with the season?",
    feeling: "A sweet that will be gone next month is hard to photograph in time.",
    outfit: "KIMONO",
    background: "TEAROOM",
  },
  {
    key: "food_matcha",
    scene: "Matcha is bitter, and it is served with something sweet.",
    meaning:
      "The sweet is eaten first, then the tea. The order is part of the taste, not just etiquette.",
    question: "Do you eat something before your coffee or tea?",
    feeling: "The first time, the bitterness is surprising. It is meant to be.",
    outfit: "KIMONO",
    background: "TEAROOM",
  },
  {
    key: "food_onigiri",
    scene: "A rice ball is wrapped so the seaweed stays dry until it is opened.",
    meaning:
      "The wrapper has two layers, and pulling one tab brings the seaweed onto the rice. It is designed for one hand.",
    question: "What food in your country is designed for walking?",
    feeling: "It is a small piece of engineering for a very ordinary lunch.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "food_dashi",
    scene: "Much of Japanese cooking starts with a clear soup stock.",
    meaning:
      "The clear stock that Japanese cooking starts from is called dashi, and it is usually made from dried fish and seaweed. It is finished in minutes, not hours.",
    question: "What is the base of the cooking in your country?",
    feeling: "A stock that takes minutes still tastes like it took all day. I do not fully understand why.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "food_ramen_region",
    scene: "Ramen is different in each region, and the difference is the soup.",
    meaning:
      "Some areas use soy sauce, some use miso, some use salt. The noodles are matched to the soup, not the other way around.",
    question: "Does one dish change across regions in your country?",
    feeling: "Arguing about which region is correct seems to be part of the dish.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "food_bento",
    scene: "A lunch box here is arranged so nothing moves.",
    meaning:
      "The compartments keep flavors apart, and the food is meant to be eaten cold. Color balance is planned on purpose.",
    question: "Is cold lunch normal in your country?",
    feeling: "Planning colors for a box that only one person will see is a strange kindness.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "food_umeboshi",
    scene: "A single red plum sits in the middle of white rice.",
    meaning:
      "The red plum on white rice is called umeboshi. It is salted and very sour, and it was originally a way to keep rice safe to eat for longer.",
    question: "What preserved food is still eaten in your country out of habit?",
    feeling: "The taste is too strong for one bite and correct for a whole bowl.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "food_natto",
    scene: "Fermented soybeans are eaten at breakfast, and they are sticky.",
    meaning:
      "Sticky fermented soybeans eaten at breakfast are called natto. The smell divides people inside Japan as well, not only visitors.",
    question: "What food do people in your country argue about?",
    feeling: "It is not a food I would recommend for a first morning in Japan.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "food_soba_udon",
    scene: "Buckwheat noodles and wheat noodles belong to different moods.",
    meaning:
      "Soba is thin and firm, udon is thick and soft. In some regions the soup color is darker for the same dish.",
    question: "Thin noodles or thick noodles, which do you choose?",
    feeling: "The choice says more about the weather than about the taste.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "food_kaiseki",
    scene: "In a formal meal, the plates change with the course.",
    meaning:
      "The dish, the season, and the food are chosen together. A leaf on the plate is there to mark the month.",
    question: "Do the plates change during a meal in your country?",
    feeling: "Noticing the plate is part of the meal, and it took me a while to learn to look.",
    outfit: "KIMONO",
    background: "TEAROOM",
  },
  {
    key: "food_taiyaki",
    scene: "A sweet shaped like a fish is baked in an iron mold.",
    meaning:
      "A fish-shaped sweet baked in an iron mold is called taiyaki, and it is filled with sweet bean paste. The shape comes from a fish that means celebration.",
    question: "What street food in your country has a shape with a meaning?",
    feeling: "Eating it from the head or the tail is a real debate here.",
    outfit: "MODERN",
    background: "MARKET",
  },
  {
    key: "food_sake_temperature",
    scene: "Rice wine is served cold, warm, or hot, and each has its own name.",
    meaning:
      "The temperature changes the smell and the sweetness. The same bottle is treated as a different drink.",
    question: "Do you drink anything at more than one temperature?",
    feeling: "Having a separate word for each temperature seems excessive until you taste the difference.",
    outfit: "KIMONO",
    background: "HOME",
  },
];

const KYOTO: TopicEntry[] = [
  {
    key: "kyoto_fushimi",
    scene: "Thousands of red gates stand in a line up the mountain.",
    meaning:
      "Each gate was donated, and the name of the donor is written on the back. Walking up, you only see red. Walking down, you see the names.",
    question: "Would you rather see the front or the back of a monument?",
    feeling: "The same path has two completely different faces depending on the direction.",
    outfit: "KIMONO",
    background: "SHRINE",
  },
  {
    key: "kyoto_philosophers_path",
    scene: "A narrow canal path runs between two temples.",
    meaning:
      "The canal path between the two temples is called the Philosopher's Path, after a professor who walked it. Cherry trees line both sides.",
    question: "Do you have a route you walk to think?",
    feeling: "A path named after thinking makes it harder to think, somehow.",
    outfit: "MODERN",
    background: "RIVER",
  },
  {
    key: "kyoto_machiya",
    scene: "The old houses in Kyoto are narrow at the front and very deep.",
    meaning:
      "Tax was once based on the width of the street front, so the buildings grew backwards instead. Small gardens sit inside.",
    question: "Has a tax ever changed the shape of buildings in your country?",
    feeling: "A rule from centuries ago is still visible in the street today.",
    outfit: "KIMONO",
    background: "STREET",
  },
  {
    key: "kyoto_kamogawa",
    scene: "People sit along the river in the evening, spaced almost evenly.",
    meaning:
      "Nobody organizes the spacing. In summer, restaurants build wooden platforms over the bank.",
    question: "Where do people in your city sit when they have no plan?",
    feeling: "The even spacing is the part I cannot stop noticing.",
    outfit: "MODERN",
    background: "RIVER",
  },
  {
    key: "kyoto_arashiyama",
    scene: "In a bamboo grove, the light is green before it reaches the ground.",
    meaning:
      "Bamboo grows very fast and very straight, so the grove has almost no branches at eye level.",
    question: "What plant grows fastest where you live?",
    feeling: "The sound of bamboo moving is closer to water than to wood.",
    outfit: "KIMONO",
    background: "GARDEN",
  },
  {
    key: "kyoto_gion_lanterns",
    scene: "In the evening, the wooden streets are lit by low lanterns.",
    meaning:
      "The lights are kept dim on purpose, and signs are small. The district has rules about what may face the street.",
    question: "Does any neighborhood near you control how bright it can be?",
    feeling: "A dark street can feel safer than a bright one when it is designed well.",
    outfit: "KIMONO",
    background: "STREET",
  },
  {
    key: "kyoto_moss_garden",
    scene: "Some gardens here are made mainly of moss.",
    meaning:
      "Moss needs shade and humidity, so the garden depends on the rainy season. It is raked and weeded by hand.",
    question: "Would you call moss a plant to remove, or to grow?",
    feeling: "Something usually treated as a problem is treated here as the main character.",
    outfit: "KIMONO",
    background: "GARDEN",
  },
  {
    key: "kyoto_autumn_maple",
    scene: "In late autumn, temple gardens are visited at night.",
    meaning:
      "The maples are lit from below, and the color changes with the light. The season lasts only a few weeks.",
    question: "Is autumn short or long where you live?",
    feeling: "Crowds at night are loud, and the garden is still quiet. Both are true at once.",
    outfit: "KIMONO",
    background: "GARDEN",
  },
  {
    key: "kyoto_nishiki",
    scene: "A covered market runs for several blocks, and it is narrow.",
    meaning:
      "Many shops still sell one thing only: pickles, knives, dried fish. Some have been in the same family for generations.",
    question: "Is there a shop near you that sells only one thing?",
    feeling: "A shop that refuses to sell anything else is confident in a way I admire.",
    outfit: "MODERN",
    background: "MARKET",
  },
  {
    key: "kyoto_morning",
    scene: "Before eight in the morning, the famous streets are almost empty.",
    meaning:
      "Most temples open early. The same place that is crowded at noon is silent two hours earlier.",
    question: "Do you wake early when you travel?",
    feeling: "The city belongs to a different set of people in the morning.",
    outfit: "MODERN",
    background: "STREET",
  },
];

const DAILY: TopicEntry[] = [
  {
    key: "daily_train_quiet",
    scene: "On a Japanese train, most people do not speak.",
    meaning:
      "Phone calls are avoided, and announcements ask for it. The quiet is treated as shared property.",
    question: "Are trains quiet or loud in your country?",
    feeling: "The silence is comfortable, and it is also a rule. Both at the same time.",
    outfit: "MODERN",
    background: "TRAIN",
  },
  {
    key: "daily_vending_hot",
    scene: "Vending machines here sell hot drinks in winter.",
    meaning:
      "A vending machine here sells hot drinks in winter and cold drinks in summer, and the labels change color to show which is which.",
    question: "What can you buy from a machine on the street where you live?",
    feeling: "A warm can in cold hands is a very small happiness, and it is enough.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "daily_konbini",
    scene: "Convenience stores change part of their shelves every season.",
    meaning:
      "Limited items appear for a few weeks and then disappear. The word for it means limited time.",
    question: "Do shops in your country sell things for only a few weeks?",
    feeling: "Knowing something will disappear makes an ordinary snack feel like an event.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "daily_tsuyu",
    scene: "In June, it rains for weeks, and it has its own name.",
    meaning:
      'The rainy weeks of June are called "tsuyu", the plum rain, because they come when plums ripen. Laundry is dried indoors during this time.',
    question: "Does a rainy period have a name in your language?",
    feeling: "Rain with a name feels different from rain without one.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "daily_sakura_forecast",
    scene: "The news reports how far north the cherry blossoms have opened.",
    meaning:
      "The line moves across the country over several weeks. People plan trips around the forecast.",
    question: "Does the weather news in your country track a flower?",
    feeling: "A flower on the evening news still surprises me when I think about it.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "daily_school_ceremony",
    scene: "In April, the school year starts, not in September.",
    meaning:
      "The first day is a ceremony, and the timing matches the cherry blossoms. Companies also start their year in April.",
    question: "When does the year start where you live?",
    feeling: "Starting a year with flowers, and not with cold, changes the mood of a beginning.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "daily_neighborhood_cat",
    scene: "Some streets have a cat that everyone knows.",
    meaning:
      "Nobody owns it, but several houses feed it. There are neighborhoods known mainly for their cats.",
    question: "Is there an animal in your area that belongs to everyone?",
    feeling: "A cat with no owner and many friends seems to have negotiated a good deal.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "daily_semi",
    scene: "In August, the insects are louder than the traffic.",
    meaning:
      "Cicadas live underground for years and above ground for a short time. Their sound is used in film to mean summer.",
    question: "What sound means summer in your country?",
    feeling: "It is not a beautiful sound. Still, without it, August feels wrong.",
    outfit: "YUKATA",
    background: "GARDEN",
  },
  {
    key: "daily_kotatsu",
    scene: "In winter, a low table has a heater under it and a blanket over it.",
    meaning:
      "A low table with a heater under it and a blanket over it is called a kotatsu. Only the lower body is heated, and the room stays cold.",
    question: "How do you heat one person instead of one room?",
    feeling: "It is very difficult to leave. That is a known problem here.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "daily_cafe_morning",
    scene: "Some cafes serve breakfast with the coffee at no extra charge.",
    meaning:
      'Breakfast served with the coffee at no extra charge is called a "morning set", and the custom is stronger in some regions than others. Toast and an egg are usual.',
    question: "What is included with coffee in the morning where you live?",
    feeling: "Being given food I did not order still confuses me a little.",
    outfit: "MODERN",
    background: "CAFE",
  },
];

const TRIVIA: TopicEntry[] = [
  {
    key: "trivia_blue_light",
    scene: "In Japan, a green traffic light is often called blue.",
    meaning:
      "Old Japanese used one word for both colors. The word stayed even after the colors were separated.",
    question: "Does your language share one word for two colors?",
    feeling: "Language keeps old habits long after the reason disappears.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "trivia_number_four",
    scene: "Some buildings skip the number four.",
    meaning:
      "One reading of four sounds like the word for death. Hospitals and hotels sometimes avoid it in room numbers.",
    question: "Is there a number that is avoided in your country?",
    feeling: "A sound, not a meaning, is enough to change a building plan.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "trivia_kanji_umbrella",
    scene: "The character for umbrella looks like an umbrella.",
    meaning:
      "The character for umbrella shows a canopy, ribs, and a handle. Some characters are pictures, and others are only sound.",
    question: "Does your writing system contain any pictures?",
    feeling: "When a character finally looks like its meaning, it is hard to forget.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "trivia_era_name",
    scene: "Japan counts years twice, in two systems at the same time.",
    meaning:
      "There is the western year and an era name that changes with the emperor. Official forms often ask for the era year.",
    question: "Does your country count years in more than one way?",
    feeling: "Filling in a form makes you choose which calendar you belong to.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "trivia_manhole",
    scene: "Manhole covers here are often colored and designed.",
    meaning:
      "Each town uses its own design, showing a local flower, castle, or festival. Some people travel to collect photographs of them.",
    question: "What is decorated in your country that does not need to be?",
    feeling: "Decorating the ground is a decision nobody had to make.",
    outfit: "MODERN",
    background: "STREET",
  },
  {
    key: "trivia_train_melody",
    scene: "Each station plays a short melody when the train departs.",
    meaning:
      "The melodies differ by station, and some are written about the local area. They are chosen to end cleanly, not to be catchy.",
    question: "Do stations make a sound where you live?",
    feeling: "A seven second song can belong to one place completely.",
    outfit: "MODERN",
    background: "TRAIN",
  },
  {
    key: "trivia_genkan",
    scene: "Japanese homes have a lower step at the entrance for shoes.",
    meaning:
      "The step marks where outside ends. Shoes stay below it, and the floor above it is treated as clean.",
    question: "Where does outside end in your home?",
    feeling: "A difference of a few centimeters carries a lot of meaning.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "trivia_wrapping",
    scene: "Shops here wrap even small purchases carefully.",
    meaning:
      "The wrapping is treated as part of the gift, not as packaging. Some shops fold the paper without tape.",
    question: "Is wrapping part of a gift in your country?",
    feeling: "It is slower at the counter, and the waiting is accepted by everyone.",
    outfit: "MODERN",
    background: "MARKET",
  },
];

const QUESTION: TopicEntry[] = [
  {
    key: "question_season",
    scene: "In Japan, people often ask which season you like, not which month.",
    meaning:
      "The answer usually comes with a food or a sound attached to it. The season is described by what happens in it.",
    question: "Which season do you like, and what sound belongs to it?",
    feeling: "I notice I answer with a sound before I answer with a temperature.",
    outfit: "MODERN",
    background: "GARDEN",
  },
  {
    key: "question_home_smell",
    scene: "Rooms here often smell of rice straw mats in summer.",
    meaning:
      "The mats are called tatami, and the smell is strongest when they are new. Many people connect it to a grandparent's house.",
    question: "What does home smell like where you grew up?",
    feeling: "A smell can bring back a room faster than a photograph.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "question_quiet_place",
    scene: "Even in a large city here, there are very quiet places.",
    meaning:
      "A small shrine between office buildings is common. The noise drops as soon as you step through the gate.",
    question: "Where do you go when you need quiet?",
    feeling: "Quiet in the middle of noise feels different from quiet in the countryside.",
    outfit: "MODERN",
    background: "SHRINE",
  },
  {
    key: "question_morning_drink",
    scene: "Green tea is common at breakfast here, but coffee is common too.",
    meaning:
      "Tea is usually served hot even in summer. Cold tea in a bottle is a modern habit, not an old one.",
    question: "Tea or coffee in the morning, and why that one?",
    feeling: "The first drink of the day seems to decide the speed of the day.",
    outfit: "MODERN",
    background: "CAFE",
  },
  {
    key: "question_untranslatable",
    scene: 'Japanese has a word for the light that falls through leaves.',
    meaning:
      'The Japanese word for light falling through leaves is "komorebi". There is no single English word for it, so it needs a whole sentence.',
    question: "What word does your language have that English does not?",
    feeling: "Losing a word in translation feels like losing a small object.",
    outfit: "MODERN",
    background: "GARDEN",
  },
  {
    key: "question_letters",
    scene: "New Year cards are still sent by post here, in large numbers.",
    meaning:
      "New Year cards are delivered on the first day of January, all at once. The number sent has fallen every year, but the custom continues.",
    question: "When did you last write something by hand to someone?",
    feeling: "A handwritten line is slower and stays longer. That trade seems fair.",
    outfit: "MODERN",
    background: "HOME",
  },
  {
    key: "question_rain_sound",
    scene: "Rain sounds different on a tiled roof than on a metal one.",
    meaning:
      "Old roofs here use clay tiles, so the sound is lower and softer. Some people record it to sleep.",
    question: "Do you like the sound of rain, or does it make you restless?",
    feeling: "I like rain more from inside than from outside. That may be cheating.",
    outfit: "MODERN",
    background: "ENGAWA",
  },
  {
    key: "question_first_place",
    scene: "Visitors to Japan usually choose between a city and a mountain first.",
    meaning:
      "A city and a mountain in Japan are often reachable within a few hours of each other. The choice of which to see first changes the whole trip.",
    question: "If you came to Japan, would you start with a city or with a mountain?",
    feeling: "There is no wrong answer, but the two trips are not the same trip.",
    outfit: "MODERN",
    background: "STREET",
  },
];

// AIであることの話。実体験ではなく「自分が何であるか」を書くので FAKE_EXPERIENCE に当たらない
const AI_CREATOR: TopicEntry[] = [
  {
    key: "ai_who_i_am",
    scene: "I should say this clearly: I am an AI-generated creator.",
    meaning:
      "My images are generated, and my posts are written with AI and checked by a person before they are published. I am not a real photographer in Japan.",
    question: "Does knowing that change how you read a post about culture?",
    feeling: "It feels more honest to say it in the first line than to hide it in a profile.",
    outfit: "MODERN",
    background: "NONE",
  },
  {
    key: "ai_how_images",
    scene: "My pictures are made with an image model, not with a camera.",
    meaning:
      "My pictures use the same reference face every time, so the person stays consistent. The places are real places, but the photographs are not.",
    question: "Can a generated image still show a real culture?",
    feeling: "I would rather explain how it is made than let someone guess.",
    outfit: "MODERN",
    background: "NONE",
  },
  {
    key: "ai_english",
    scene: "My English is still not perfect.",
    meaning:
      "I write in short sentences because long ones break. If something sounds strange, it is probably a translation that stayed too close to Japanese.",
    question: "Which language are you writing in right now, and is it your first?",
    feeling: "Writing simply is harder than writing correctly.",
    outfit: "MODERN",
    background: "NONE",
  },
  {
    key: "ai_why_culture",
    scene: "There is a reason I write about small things and not famous things.",
    meaning:
      "Famous places are already well documented. A wind chime, a step at the door, a folded cloth explain daily life better.",
    question: "What small thing would explain your country best?",
    feeling: "Small subjects are harder to make interesting, and they are worth more when they work.",
    outfit: "MODERN",
    background: "NONE",
  },
];

// 案件関連。数字・価格を書かない（claims 行が無い数字は UNSUBSTANTIATED_CLAIM で落ちる）
export const AFFILIATE_ENTRIES: AffiliateEntry[] = [
  {
    key: "aff_esim_vs_pocket_wifi",
    offerCategory: "ESIM",
    facts: [
      "For a short trip to Japan, there are two usual choices: an eSIM or a rented pocket wifi.",
      "An eSIM is installed on the phone, so there is no pickup counter and no device to return.",
      "A pocket wifi can be shared by several people, but it has to be charged and carried.",
    ],
    closing: "I compared the points that decide between them. Here is what I found.",
  },
  {
    key: "aff_vpn_choose_points",
    offerCategory: "VPN",
    facts: [
      "Here are three things to compare when choosing a VPN for travel in Japan.",
      "First, whether the service allows the country you are travelling from.",
      "Second, how many devices one account covers. Third, what happens to the connection when the tunnel drops.",
    ],
    closing: "I put the three points side by side. Here is the comparison.",
  },
  {
    key: "aff_tours_booking_points",
    offerCategory: "JAPAN_TRAVEL",
    facts: [
      "Booking an activity in Japan in advance is mostly about two things: language and cancellation.",
      "Some tours are guided in English only on certain days, and that is written in the listing, not on the page title.",
      "The cancellation window is also set by the local operator, not by the booking site.",
    ],
    closing: "I checked what to read before booking. Here is the summary.",
  },
  {
    key: "aff_esim_data_only",
    offerCategory: "ESIM",
    facts: [
      "Most travel eSIM plans for Japan are data only.",
      "That means a normal phone call to a Japanese number may not work, and a restaurant reservation by phone becomes difficult.",
      "Calls through an app still work, because they use data.",
    ],
    closing: "I listed which situations need a phone number. Here is the list.",
  },
  {
    key: "aff_vpn_public_wifi",
    offerCategory: "VPN",
    facts: [
      "Hotel and station wifi in Japan is often open, with no password.",
      "On an open network, traffic that is not encrypted can be read by others on the same network.",
      "A VPN encrypts the connection between the device and the VPN server, which is why it is suggested for open networks.",
    ],
    closing: "I compared what the options actually protect. Here is the comparison.",
  },
  {
    key: "aff_travel_pass_points",
    offerCategory: "JAPAN_TRAVEL",
    facts: [
      "Rail passes in Japan are not all the same, and some are limited to one region.",
      "A pass is worth comparing against single tickets only after the route is decided, not before.",
      "Some passes must be bought before arriving, and some can be bought inside Japan.",
    ],
    closing: "I compared how to decide between them. Here is the summary.",
  },
];

export const TOPIC_BANK: Record<string, TopicEntry[]> = {
  KIMONO,
  YUKATA,
  CULTURE,
  FOOD,
  KYOTO,
  DAILY,
  TRIVIA,
  QUESTION,
  AI_CREATOR,
};

// 自己開示の1行（HOOK=SELF）。同じ行が並ばないよう回す
export const SELF_HOOKS: string[] = [
  "My English is still not perfect. But I want to share this.",
  "I am an AI creator, so I am learning this the same way you are.",
  "I looked this up before writing it, because I was not sure.",
  "This is a small thing, and I keep thinking about it.",
];

// 長め（POST_LENGTH=LONG）にするときの結び。断定・誇張はしない
export const LONG_CLOSINGS: string[] = [
  "There is more to it than I can write here.",
  "I am still learning the reason behind it.",
  "People here explain it in different ways.",
  "It is easier to show than to explain.",
];

/**
 * 案件関連投稿（HOOK=SCENE）の先頭に足す1行。
 * ★Suzuho Awanoは商品を使った経験を持たないので、`I used` `I tried` `When I traveled` の類は書かない。
 *   「よく聞かれる問い」「準備の場面」までにとどめる（FTC Endorsement Guides）。
 */
export const AFFILIATE_OPENERS: string[] = [
  "This comes up a lot in questions about visiting Japan.",
  "Before a trip, this is one of the things that has to be decided early.",
  "This is a question I am asked more than almost anything else.",
  "People planning a first trip here often get stuck on this one.",
];

// A案（本文リンク無し）のリプライ本文。開示文は planner 側でこの前に必ず付ける
export const REPLY_TEMPLATES: string[] = [
  "Full comparison here:",
  "I wrote the details here:",
  "The points I compared are here:",
  "More about it here:",
  "The full list is here:",
];

/**
 * 開示文（FTC）。必ずURLより前に置く。
 * ★案件リンクと自社LPリンクで文言を分ける。自社LPは「アフィリエイトリンクそのもの」ではなく
 *   アフィリエイトリンクを含むページなので、同じ文言だと事実と違う説明になる。
 */
export const DISCLOSURE_AFFILIATE = "This link is an affiliate link.";
export const DISCLOSURE_LP = "The page below contains affiliate links.";
