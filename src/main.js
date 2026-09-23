import { Actor } from "apify";

await Actor.init();

const input = (await Actor.getInput()) ?? {};

const keywords =
    input.keywords?.length
        ? input.keywords
        : ["bounty", "reward", "paid task"];

const repositories = input.repositories ?? [];
const maxResults = Math.min(Math.max(input.maxResults ?? 25, 1), 100);
const minReward = Number(input.minReward ?? 0);

const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Expert-Edge-Vault-GitHub-Bounty-Monitor",
    "X-GitHub-Api-Version": "2022-11-28"
};

const rewardRegex =
    /(?:\$|USD\s*|USDC\s*|EUR\s*|€\s*|RTC\s*|MRG\s*)(\d+(?:\.\d+)?)/i;

function getCurrency(text) {
    if (/USDC/i.test(text)) return "USDC";
    if (/RTC/i.test(text)) return "RTC";
    if (/MRG/i.test(text)) return "MRG";
    if (/EUR|€/i.test(text)) return "EUR";
    if (/\$|USD/i.test(text)) return "USD";
    return null;
}

const results = [];
const seen = new Set();

for (const keyword of keywords) {
    if (results.length >= maxResults) break;

    let query = `${keyword} is:issue is:open`;

    if (repositories.length === 1) {
        query += ` repo:${repositories[0]}`;
    }

    const apiUrl =
        "https://api.github.com/search/issues" +
        `?sort=updated&order=desc&per_page=${maxResults}` +
        `&q=${encodeURIComponent(query)}`;

    const response = await fetch(apiUrl, { headers });

    if (!response.ok) {
        throw new Error(
            `GitHub API ${response.status}: ${await response.text()}`
        );
    }

    const data = await response.json();

    for (const issue of data.items ?? []) {
        if (results.length >= maxResults) break;
        if (seen.has(issue.html_url)) continue;

        const repository =
            issue.repository_url.split("/repos/")[1];

        if (
            repositories.length &&
            !repositories.includes(repository)
        ) {
            continue;
        }

        const text = `${issue.title}
${issue.body ?? ""}`;

        const match = text.match(rewardRegex);
        const reward = match ? Number(match[1]) : null;

        if (reward !== null && reward < minReward) {
            continue;
        }

        const zeroCapitalRisk =
            /bond|deposit|stake|pay\s+to\s+claim|entry fee/i.test(text);

        if (input.zeroCapitalOnly && zeroCapitalRisk) {
            continue;
        }

        seen.add(issue.html_url);

        results.push({
            title: issue.title,
            url: issue.html_url,
            repository,
            reward,
            currency: getCurrency(text),
            labels: (issue.labels ?? []).map((x) => x.name),
            comments: issue.comments,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            zeroCapitalRisk
        });
    }
}

await Actor.pushData(results);

await Actor.setValue("SUMMARY", {
    found: results.length,
    checkedKeywords: keywords,
    repositories
});

console.log(`Found ${results.length} bounty opportunities.`);

await Actor.exit();
