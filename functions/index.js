/* eslint-disable max-len */
/* eslint-disable no-undef */
const functions = require("firebase-functions");

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const puppeteer = require("puppeteer");
const chromium = require("chrome-aws-lambda");
const axios = require("axios");
const {Article} = require("./Article");

exports.test = functions
    .region("europe-west1")
    .https.onRequest((req, res) => {
        const {exclude} = req.body;

        res.json(JSON.stringify(exclude));
    });

exports.home = functions
    .region("europe-west1")
    .https.onRequest(async (req, res) => {
        // Parameters and body
        const per = Number(req.query.per ?? 20);
        const page = Number(req.query.page ?? 0);
        const {exclude} = req.body;

        /**
        * Combines 2 arrays.
        * @param {array} first The first array.
        * @param {array} second The second array.
        * @return {array} the combined arrays.
        */
        function combine(first, second) {
            const min = Math.min(first.length, second.length);
            let i = 0;
            const result = [];

            while (i < min) {
                result.push(first[i], second[i]);
                ++i;
            }
            return result.concat(first.slice(min), second.slice(min));
        }

        // --------- VARS ---------
        const firebaseProviders = ["euroinvester", "dr"];
        let redditAmount = 0;
        let redditArticles = [];
        let euroArticles = [];
        let drArticles = [];
        const amountOfFirebaseArticles = firebaseProviders.reduce((a, c) => a + exclude.includes(c), 0);

        // --------- REDDIT ---------
        // Fetch from endpoint
        if (!exclude.includes("reddit")) {
            const subreddit = "stocks";
            const endpoint = `https://www.reddit.com/r/${subreddit}/top.json`;
            let redditData;
            try {
                redditData = await axios.get(endpoint);
            } catch {
                res.json("reddit error");
                return;
            }

            // Pagination
            const amountOfStickyPost = 0;
            const multiplier = (amountOfFirebaseArticles - firebaseProviders.length === 0) ? 1 : 0.25;
            const redditStart = (Math.floor(per * multiplier) * page) + amountOfStickyPost;
            const redditEnd = Math.floor(per * multiplier) + redditStart;
            redditAmount = redditEnd > redditData?.data.data.children.length ? 0 : Math.floor(per * 0.25);

            // Get and process data
            redditArticles = redditData?.data.data.children.slice(redditStart, redditEnd).map((post) => {
                return new Article(
                    post.data.title, post.data.url,
                    null, `r/${subreddit}`, `Upvotes: ${post.data.ups}`,
                    `https://www.reddit.com/r/${subreddit}`,
                    "https://styles.redditmedia.com/t5_2qjfk/styles/communityIcon_4s2v8euutis11.png?width=256&s=242549c1ad52728c825dfe24af8467626e68f392",
                    new Date(post.data.created_utc * 1000),
                );
            }) ?? [];
        }


        // --------- FIREBASE CONFIG ---------
        const newPer = Math.floor((per - redditAmount) / (amountOfFirebaseArticles == 0 ? firebaseProviders.length : amountOfFirebaseArticles));
        const push = page == 0 ? 1 : (newPer * page);

        // --------- FIREBASE EUROINVESTER ARTICLES ---------
        if (!exclude.includes("euroinvester")) {
            const articlesCollection = db.collection("articles");

            // Get content and prepare for page
            const first = articlesCollection.where("provider", "==", "euroinvestor").orderBy("date", "desc").limit(300);
            const allContent = await first.get();
            const last = allContent.docs[allContent.docs.length - push];

            // Get, process and return
            const snapshot = await articlesCollection.where("provider", "==", "euroinvestor").orderBy("date", "desc").startAt(last.data()).limit(newPer).get();
            euroArticles = [];
            snapshot.forEach((doc) => euroArticles.push(doc.data()));
        }

        // --------- FIREBASE DR-PENGE ARTICLES ---------
        if (!exclude.includes("dr")) {
            const drCollection = db.collection("drarticles");
            const drfirst = drCollection.where("provider", "==", "DR - Penge").orderBy("date", "desc").limit(300);

            const drAllContent = await drfirst.get();
            const drlast = drAllContent.docs[drAllContent.docs.length - push];

            // Get, process and return
            const drSnapshot = await drCollection.where("provider", "==", "DR - Penge").orderBy("date", "desc").startAt(drlast.data()).limit(newPer).get();
            drArticles = [];
            drSnapshot.forEach((doc) => drArticles.push(doc.data()));
        }

        // --------- RETURN ---------
        // Combine firebase arrays
        const firebaseArticles = combine(drArticles, euroArticles);
        const allArticles = combine(firebaseArticles, (redditAmount == 0 ? [] : redditArticles));
        res.json(allArticles);
    });

exports.drscraper = functions
    .region("europe-west1")
    .runWith({timeoutSeconds: 540, memory: "4GB"})
    .https.onRequest(async (req, res) => {
        const start = new Date().getTime();
        const browser = await puppeteer.launch({
            args: [
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-setuid-sandbox",
                "--no-first-run",
                "--no-sandbox",
                "--no-zygote",
                "--single-process",
            ],
            defaultViewport: chromium.defaultViewport,
            headless: chromium.headless,
        });
        const page = await browser.newPage();
        await page.goto("https://www.dr.dk/nyheder/penge");
        await page.waitForSelector(".hydra-site-front-page-content");

        const items = await page.evaluate(() => {
            const d = new Date();
            let month = "" + (d.getMonth() + 1);
            let day = "" + d.getDate();
            const year = d.getFullYear();

            if (month.length < 2) {
                month = "0" + month;
            }
            if (day.length < 2) {
                day = "0" + day;
            }

            const finalDate = [day, month, year].join("/");

            const chunks = document.querySelectorAll(".hydra-site-front-page-content")[0].childNodes;
            const data = [];

            chunks.forEach((article) => {
                const sections = article.querySelectorAll("li");

                for (let i = 0; i < sections.length; i++) {
                    const titleEl = sections[i].querySelectorAll("a")[sections[i].querySelectorAll("a").length - 1];
                    const title = titleEl.getAttribute("aria-label");
                    const img = sections[i].querySelectorAll("source")[0];
                    const date = sections[i].querySelectorAll(".dre-teaser-meta__part");
                    let dateString = "";

                    if (title == null || title == undefined) {
                        break;
                    }

                    // Format date into normal one, if date includes "i dag" or "i går"
                    if (date && date[1].innerHTML) {
                        const raw = date && date[1].innerHTML;
                        if (raw.includes("går") || raw.includes("dag")) {
                            dateString = `${raw.split("kl. ")[1]} ${finalDate}`;
                        } else if (raw.includes("siden")) {
                            dateString = finalDate;
                        } else {
                            dateString = raw;
                        }
                    }

                    data.push({
                        title: title.split(", fra")[0],
                        link: `https://www.dr.dk${titleEl.getAttribute("href")}`,
                        img: img && img.getAttribute("srcset").split(" ")[2],
                        provider: "DR - Penge",
                        // eslint-disable-next-line no-useless-escape
                        providerText: `Fra${title.split(", fra")[1]}`.replace(/\"/g, ""),
                        providerLink: "https://www.dr.dk/nyheder/penge",
                        providerImage: "https://4hansson.dk/test/ticker/drlogo.png",
                        displayDate: dateString,
                    });
                }
            });

            return data;
        });

        // Operation done close browser
        await browser.close();


        // Get 50 latest articles from Firestore
        const articlesCollection = db.collection("drarticles");
        const snapshot = await articlesCollection.where("provider", "==", "DR - Penge").orderBy("date", "desc").limit(60).get();
        const articles = [];
        snapshot.forEach((doc) => articles.push(doc.data()));

        // Remove duplicates
        const final = items.filter((item) => !articles.find((article) => item.title === article.title));

        // Add ms time
        const ms = (new Date().getTime()) - start;
        final.map((item) => item.time = ms);

        // Add to Firebase Firestore collection
        for (let i = 0; i < final.length; i++) {
            await db.collection("drarticles").add({...final[i], ...{date: admin.firestore.Timestamp.now()}});
        }

        res.json({result: "success", time: ms, placed: final});
        return;
    });

exports.scraper = functions
    .region("europe-west1")
    .runWith({timeoutSeconds: 540, memory: "4GB"})
    .https.onRequest(async (req, res) => {
        const start = new Date().getTime();
        const browser = await puppeteer.launch({
            args: [
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-setuid-sandbox",
                "--no-first-run",
                "--no-sandbox",
                "--no-zygote",
                "--single-process",
            ],
            defaultViewport: chromium.defaultViewport,
            headless: chromium.headless,
        });
        const page = await browser.newPage();
        await page.goto("https://www.euroinvestor.dk/nyheder");
        await page.waitForSelector(".content-wrapper");

        const items = await page.evaluate(() => {
            const data = []; const articles = document.getElementsByTagName("article");

            const d = new Date();
            let month = "" + (d.getMonth() + 1);
            let day = "" + d.getDate();
            const year = d.getFullYear();

            if (month.length < 2) {
                month = "0" + month;
            }
            if (day.length < 2) {
                day = "0" + day;
            }

            const finalDate = [day, month, year].join("/");

            articles.forEach((article) => {
                const title = article.querySelector("div > a:last-child > h2").innerHTML;
                const link = article.querySelector("div a:last-child").href;
                const img = article.childNodes.length == 2 ? article.querySelector("figure").getAttribute("data-original") : "";

                data.push({title: title, link: link, img: img,
                    provider: "euroinvestor",
                    providerText: "NYHEDER",
                    providerLink: "https://www.euroinvestor.dk",
                    providerImage: "https://4hansson.dk/test/ticker/euroinvestorlogo.png",
                    displayDate: finalDate,
                });
            });

            return data.reverse();
        });

        // Operation done close browser
        await browser.close();

        // Get 50 latest articles from Firestore
        const articlesCollection = db.collection("articles");
        const snapshot = await articlesCollection.where("provider", "==", "euroinvestor").orderBy("date", "desc").limit(40).get();
        const articles = [];
        snapshot.forEach((doc) => articles.push(doc.data()));

        // Remove duplicates
        const final = items.filter((item) => !articles.find((article) => item.title === article.title));

        // Add ms time
        const ms = (new Date().getTime()) - start;
        final.map((item) => item.time = ms);

        // Add to Firebase Firestore collection
        for (let i = 0; i < final.length; i++) {
            await db.collection("articles").add({...final[i], ...{date: admin.firestore.Timestamp.now()}});
        }

        res.json({result: "success", time: ms, placed: final});
    });

exports.providers = functions
    .region("europe-west1")
    .https.onRequest((req, res) => {
        const providers = [
            {title: "euroinvester", id: "euroinvester"},
            {title: "r/stocks", id: "reddit"},
            {title: "DR Penge", id: "dr"},
        ];
        res.json(providers);
    });
