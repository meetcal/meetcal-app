//
//  MeetCalAPI.swift
//  MeetCal App Intents
//
//  Minimal async URLSession client for MeetCal's Convex queries, called through
//  Convex's HTTP API (`POST <deployment>/api/query`). The queries are the ones
//  lib/api/meetcal-api.ts calls and answer the same JSON the old REST routes
//  did, so the response models are unchanged. Only the fields the intents use
//  are decoded; unknown fields are ignored so server additions never break it.
//
//  Premium queries carry the shared access pass (docs/backend.md, "Premium
//  data"), fetched with the MeetCal-issued token the app stores for Siri
//  (`SiriToken`, lib/siri-token.ts). `PremiumGate` in Intents.swift still
//  decides what the intents show.
//

import Foundation
import CryptoKit
import Security

// MARK: - Response models (decode-what-you-need)

struct APIMeet: Decodable {
    let id: String?
    let name: String
    let start_date: String
    let end_date: String
    let time_zone: String?
    let venue_name: String?
    let venue_city: String?
    let venue_state: String?
    let status: String?

    var locationLine: String {
        [venue_name, [venue_city, venue_state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " — ")
    }

    var datesLine: String {
        if start_date == end_date { return APIDateFormat.pretty(start_date) }
        return "\(APIDateFormat.pretty(start_date)) – \(APIDateFormat.pretty(end_date))"
    }
}

struct APIScheduleRow: Decodable {
    let date: String
    let meet: String?
    let platform: String
    let session_id: Int
    let start_time: String
    let weigh_in_time: String?
    let weight_class: String
}

struct APIAthlete: Decodable {
    let member_id: String?
    let name: String
    let age: Int?
    let club: String?
    let gender: String?
    let weight_class: String?
    let entry_total: Int?
    let meet: String?
    let session_number: Int?
    let session_platform: String?
    let wso: String?
}

struct APILiftingResult: Decodable {
    let meet: String?
    let date: String?
    let name: String?
    let age: String?
    let body_weight: Double?
    let snatch_best: Int?
    let cj_best: Int?
    let total: Int?
}

struct APISearchResponse: Decodable {
    let matched_name: String?
    let suggestions: [String]?
    let results: [APILiftingResult]?
}

struct APIYearBests: Decodable {
    let best_snatch: Double?
    let best_cj: Double?
    let best_total: Double?

    /// `results:bests` answers every requested name, with zeros for a name it
    /// has no results for in the window (a typo, a lifter who has not
    /// competed lately). Zeros are "no bests", never a 0 kg best.
    var hasAnyBest: Bool {
        [best_snatch, best_cj, best_total].contains { ($0 ?? 0) > 0 }
    }
}

struct APIQualifyingTotalRow: Decodable {
    let event_name: String?
    let gender: String?
    let age_category: String?
    let weight_class: String?
    let qualifying_total: Double?
}

struct APIStandardRow: Decodable {
    let age_category: String?
    let gender: String?
    let standard_a: Double?
    let standard_b: Double?
    let weight_class: String?
}

struct APIRecordRow: Decodable {
    let age_category: String?
    let gender: String?
    let weight_class: String?
    let record_type: String?
    let snatch_record: Double?
    let cj_record: Double?
    let total_record: Double?
}

struct APIIntlRankingRow: Decodable {
    let meet: String?
    let ranking: Int?
    let name: String?
    let weight_class: String?
    let total: Double?
    let percent_a: Double?
    let gender: String?
    let age_category: String?
}

enum APIDateFormat {
    static func pretty(_ iso: String) -> String {
        let input = DateFormatter()
        input.dateFormat = "yyyy-MM-dd"
        input.locale = Locale(identifier: "en_US_POSIX")
        let datePart = String(iso.prefix(10))
        guard let date = input.date(from: datePart) else { return iso }
        let output = DateFormatter()
        output.dateStyle = .medium
        output.timeStyle = .none
        return output.string(from: date)
    }
}

/// Calendar-day labels for the schedule. A `YYYY-MM-DD` meet date is a
/// calendar date, so it is parsed and formatted in UTC on both sides: the
/// device zone never moves it to the day before.
enum APIDayFormat {
    private static let utc = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current

    /// "Sat, Jun 20" for `2026-06-20`; nil for anything that is not a date
    /// ("TBD", empty).
    static func short(_ iso: String?) -> String? {
        guard let iso, iso.count >= 10 else { return nil }
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.timeZone = utc
        input.dateFormat = "yyyy-MM-dd"
        input.isLenient = false
        guard let date = input.date(from: String(iso.prefix(10))) else { return nil }
        let output = DateFormatter()
        output.timeZone = utc
        output.setLocalizedDateFormatFromTemplate("EEEMMMd")
        return output.string(from: date)
    }
}

/// Session clock times as the app shows them. `meets:schedule` sends times
/// as stored ("14:00:00"); the app formats them through `formatApiTime`
/// (lib/api/meetcal-api.ts) and `parseClockTime` (utils/timezone.ts), and
/// this accepts the same shapes: `H:MM`, `H:MM:SS`, `h:mm AM` and
/// `h:mm:ss PM`. Wall-clock text only, never a `Date`, so no zone applies.
enum APITimeFormat {
    /// "2:00 PM" for "14:00:00"; anything unreadable as sent.
    static func display(_ raw: String) -> String {
        let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let (hour, minute) = parse(input) else { return input }
        let period = hour >= 12 ? "PM" : "AM"
        let displayHour = hour % 12 == 0 ? 12 : hour % 12
        return "\(displayHour):\(minute < 10 ? "0" : "")\(minute) \(period)"
    }

    /// Hour (0-23) and minute, or nil when `input` is not a clock time.
    static func parse(_ input: String) -> (hour: Int, minute: Int)? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        var period: String?
        for candidate in ["AM", "PM"] where text.hasSuffix(candidate) {
            period = candidate
            text = String(text.dropLast(2)).trimmingCharacters(in: .whitespaces)
        }
        let parts = text.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 2 || parts.count == 3,
              parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } }),
              parts[0].count <= 2,
              parts.dropFirst().allSatisfy({ $0.count == 2 }),
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              minute <= 59,
              (parts.count == 2 ? 0 : Int(parts[2]) ?? 60) <= 59
        else { return nil }
        if let period {
            guard (1...12).contains(hour) else { return nil }
            return (hour % 12 + (period == "PM" ? 12 : 0), minute)
        }
        guard hour <= 23 else { return nil }
        return (hour, minute)
    }
}

// MARK: - Request bodies

/// One athlete's bests as `results:bests` lists them (`[{ name, best_* }]`:
/// Convex object keys must be ASCII and athlete names are not, so the query
/// answers a list that `bests(names:)` turns back into a name-keyed map).
struct APINamedBests: Decodable {
    let name: String
    let best_snatch: Double?
    let best_cj: Double?
    let best_total: Double?
}

/// `accessPass:pass`'s answer: the pass, and when to ask for the next (ms).
struct APIAccessPass: Decodable {
    let pass: String
    let rotatesAt: Double
}

/// `entitlements:refresh`'s answer: whether the server found a subscription.
struct APIEntitlement: Decodable {
    let active: Bool
}

// MARK: - Siri's sign-in token

/// The MeetCal-issued token (`apiTokens:issue`, 90 days) the app keeps in the
/// keychain for Siri while a subscriber is signed in, and deletes when they
/// sign out (lib/siri-token.ts). Used only to fetch the access pass: it is
/// never sent with a data query.
struct SiriToken: Decodable {
    let token: String
    let tokenId: String
    /// Milliseconds since 1970.
    let expiresAt: Double

    /// Where expo-secure-store saves the item: an item without biometric
    /// protection goes under the service `<keychainService>:no-auth`, with
    /// the key, as UTF-8 data, for its account. `SIRI_TOKEN_KEYCHAIN_SERVICE`
    /// and `SIRI_TOKEN_KEY` in lib/siri-token.ts; a test keeps them equal.
    static let service = "meetcal.siri:no-auth"
    static let account = "siri_api_token"

    /// The stored token; nil when there is none (signed out, not a
    /// subscriber, the app has not run since updating) or it has expired.
    /// The intents run in the app's process, so the item is the app's own;
    /// it is readable once the phone has been unlocked after starting.
    static func stored(now: Date = Date()) -> SiriToken? {
        var query = itemQuery
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let stored = try? JSONDecoder().decode(SiriToken.self, from: data),
              !stored.token.isEmpty,
              stored.expiresAt / 1000 > now.timeIntervalSince1970
        else { return nil }
        return stored
    }

    /// Deletes the stored token if it is still `tokenId`. For a token the
    /// server no longer accepts (revoked, or signed with a replaced key): the
    /// app issues a new one the next time it opens, as it does when none is
    /// stored. A token the app has replaced meanwhile is left alone.
    static func discard(tokenId: String) {
        guard stored()?.tokenId == tokenId else { return }
        _ = SecItemDelete(itemQuery as CFDictionary)
    }

    private static var itemQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: Data(account.utf8),
        ]
    }
}

// MARK: - History cutoff

/// History-window cutoff dates. Mirrors `getHistoryCutoffDate(years)` and the
/// `YEAR_BESTS_YEARS` constant in utils/dateTime.ts; change them together so
/// Siri and the app ask the API for the same window.
enum HistoryCutoff {
    /// `YEAR_BESTS_YEARS` in utils/dateTime.ts.
    static let yearBestsYears = 1

    /// The `YYYY-MM-DD` cutoff `years` before `now`: today's UTC calendar date
    /// with the year reduced, exactly as the JS
    /// `Date.UTC(y - years, m, d).toISOString().split("T")[0]` computes it.
    static func date(yearsAgo years: Int, now: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current
        let today = calendar.dateComponents([.year, .month, .day], from: now)
        // A Gregorian calendar always fills the components it was asked for.
        return format(
            year: (today.year ?? 1970) - years,
            month: today.month ?? 1,
            day: today.day ?? 1
        )
    }

    /// Formats a calendar date the way JS `Date.UTC` normalizes it. The only
    /// out-of-range input a real "today" can produce is Feb 29 in a non-leap
    /// target year, which `Date.UTC` rolls forward to Mar 1 (not back to
    /// Feb 28, as `Calendar.date(byAdding:)` would).
    static func format(year: Int, month: Int, day: Int) -> String {
        var month = month
        var day = day
        let isLeapYear = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
        if month == 2, day == 29, !isLeapYear {
            month = 3
            day = 1
        }
        return "\(zeroPadded(year, width: 4))-\(zeroPadded(month, width: 2))-\(zeroPadded(day, width: 2))"
    }

    private static func zeroPadded(_ value: Int, width: Int) -> String {
        let digits = String(value)
        return String(repeating: "0", count: max(0, width - digits.count)) + digits
    }
}

// MARK: - Client

enum MeetCalAPIError: Error {
    case badStatus(Int)
    case invalidURL
    /// Convex's answer could not be read.
    case queryFailed
    /// The function ran and failed: the status our functions put in its
    /// `errorData` (`{ status, error }`), when there is one.
    case functionFailed(status: Int?)
}

actor MeetCalAPI {
    static let shared = MeetCalAPI()

    /// The Convex deployment, from the `MeetCalConvexURL` Info.plist key that
    /// app.config.js fills from `EXPO_PUBLIC_CONVEX_URL`; production otherwise.
    private let convexURL: URL = {
        let configured = (Bundle.main.infoDictionary?["MeetCalConvexURL"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return URL(string: configured.isEmpty ? "https://disciplined-hare-790.convex.cloud" : configured)
            ?? URL(string: "https://disciplined-hare-790.convex.cloud")!
    }()
    /// Names per name-list request. Matches `NAMES_QUERY_CHUNK_SIZE` in
    /// lib/api/meetcal-api.ts; the queries reject more than 100 names.
    private static let nameChunkSize = 40
    /// The queries' `MAX_LIMIT_PER_NAME`; a larger `limitPerName` is an error.
    private static let maxLimitPerName = 200
    private let session: URLSession
    private let ttl: TimeInterval = 300 // ~5 minutes

    // In-memory cache: request key -> (timestamp, raw data)
    private var memoryCache: [String: (Date, Data)] = [:]

    /// The Convex functions that answer premium data: `PREMIUM_FUNCTIONS` in
    /// convex/lib/access.ts (a test in convex-tests/access.test.ts keeps the
    /// lists equal). Calls to these carry the shared access pass.
    static let premiumFunctions: Set<String> = [
        "reference:records",
        "reference:standards",
        "reference:qualifyingTotals",
        "reference:intlRankings",
        "reference:nationalRankings",
        "reference:nationalRankingsByYear",
        "reference:wsoList",
        "reference:registrationWsos",
        "reference:wsoAgeGroups",
        "reference:wsoRecords",
        "reference:adaptiveRecords",
        "reference:clubs",
        "reference:clubAthletes",
        "reference:wsoAthletes",
        "reference:clubMeetStats",
        "results:page",
        "results:byMeet",
        "results:byNames",
        "results:recent",
        "results:yearBests",
        "results:bests",
        "results:search",
        "meets:packageForMeet",
    ]

    /// A pass, the token it was fetched with, and until when to use it before
    /// asking for the next (seconds since 1970).
    private struct HeldPass: Codable {
        let pass: String
        let until: TimeInterval
        let tokenId: String
    }

    /// The least time a pass is held, whatever its `rotatesAt` says: a clock
    /// running ahead must not turn every read into a pass fetch. The server
    /// accepts a pass for a day after it rotates. `ACCESS_PASS_MIN_HOLD_MS`
    /// in lib/api/premium-queries.ts.
    private static let passMinHold: TimeInterval = 300
    /// After a pass could not be had, how long premium reads go without
    /// asking again. `ACCESS_PASS_RETRY_AFTER_MS` in lib/api/premium-queries.ts.
    private static let passRetryAfter: TimeInterval = 30
    /// The held pass, kept across the launches between Siri invocations in
    /// the app's own defaults (the widgets never need it).
    private static let heldPassKey = "meetcalAccessPass"

    private var heldPass: HeldPass?
    private var loadedHeldPass = false
    private var passFetch: Task<HeldPass?, Never>?
    private var skipPassUntil = Date.distantPast

    /// Persisted answers, one file per request (see "TTL cache" below).
    private let cacheDirectory: URL?

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 12
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
        self.cacheDirectory = Self.makeCacheDirectory()
    }

    // MARK: Public endpoints

    func meets() async throws -> [APIMeet] {
        // `meets:list` takes the time its upcoming window is measured from,
        // rounded down to the hour as the app sends it, so answers share a cache.
        let hourMs = 3_600_000.0
        let now = (Date().timeIntervalSince1970 * 1000 / hourMs).rounded(.down) * hourMs
        return try await query("meets:list", args: ["now": now])
    }

    func schedule(meet: String) async throws -> [APIScheduleRow] {
        try await query("meets:schedule", args: ["meet": meet])
    }

    func athletes(meet: String) async throws -> [APIAthlete] {
        try await query("meets:athletes", args: ["meet": meet])
    }

    func search(_ query: String) async throws -> APISearchResponse {
        try await self.query("results:search", args: ["query": query])
    }

    /// Each name's newest `limitPerName` results (newest first), so a long
    /// career is not downloaded and cached just to show a few rows. Ranges
    /// over the whole history, not a date window, so a lifter who has not
    /// competed lately still gets their last meets.
    func resultsByNames(_ names: [String], limitPerName: Int) async throws -> [APILiftingResult] {
        let cleaned = Self.cleanNameList(names)
        guard !cleaned.isEmpty else { return [] }
        let limit = min(max(limitPerName, 1), Self.maxLimitPerName)
        var rows: [APILiftingResult] = []
        for chunk in Self.chunked(cleaned) {
            let part: [APILiftingResult] = try await query(
                "results:byNames",
                args: ["names": chunk, "limitPerName": limit]
            )
            rows.append(contentsOf: part)
        }
        return rows
    }

    func bests(names: [String]) async throws -> [String: APIYearBests] {
        let cleaned = Self.cleanNameList(names)
        guard !cleaned.isEmpty else { return [:] }
        // One cutoff for every chunk, the window the app uses.
        let cutoff = HistoryCutoff.date(yearsAgo: HistoryCutoff.yearBestsYears)
        var merged: [String: APIYearBests] = [:]
        for chunk in Self.chunked(cleaned) {
            let part: [APINamedBests] = try await query(
                "results:bests",
                args: ["names": chunk, "cutoffDate": cutoff]
            )
            for row in part {
                let bests = APIYearBests(best_snatch: row.best_snatch, best_cj: row.best_cj, best_total: row.best_total)
                // A name with no bests is left out, so the map is empty for an
                // unknown name instead of holding a row of zeros.
                if bests.hasAnyBest { merged[row.name] = bests }
            }
        }
        return merged
    }

    /// Trims each name and drops blanks, as the queries' `cleanNameList`
    /// does, so an all-blank list short-circuits instead of drawing an error.
    private static func cleanNameList(_ names: [String]) -> [String] {
        names
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// Splits a name list into requests of at most `nameChunkSize` names.
    private static func chunked(_ names: [String]) -> [[String]] {
        stride(from: 0, to: names.count, by: nameChunkSize).map { start in
            Array(names[start..<min(start + nameChunkSize, names.count)])
        }
    }

    func qualifyingTotals() async throws -> [APIQualifyingTotalRow] {
        try await query("reference:qualifyingTotals")
    }

    func standards() async throws -> [APIStandardRow] {
        try await query("reference:standards")
    }

    func records() async throws -> [APIRecordRow] {
        try await query("reference:records")
    }

    func intlRankings() async throws -> [APIIntlRankingRow] {
        try await query("reference:intlRankings")
    }

    // MARK: Core request

    /// Runs a Convex query and decodes its answer. Large answers arrive as
    /// JSON text (`{ "json": "…" }`, or `{ "etag": …, "json": "…" }` from the
    /// revalidating queries); that text is the payload. Any other value is
    /// re-encoded and decoded directly.
    private func query<T: Decodable>(_ path: String, args: [String: Any] = [:]) async throws -> T {
        // Sorted keys: the same request always hits the same cache key. The
        // pass is not part of it: every pass gets the same answer.
        let bodyData = try Self.requestBody(path, args: args)
        let cacheKey = "convex \(String(decoding: bodyData, as: UTF8.self))"
        let data: Data
        if let cached = cachedData(for: cacheKey) {
            data = cached
        } else {
            data = try await fetch(path, args: args, bodyData: bodyData)
            storeData(data, for: cacheKey)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func requestBody(_ path: String, args: [String: Any]) throws -> Data {
        let body: [String: Any] = ["path": path, "args": args, "format": "json"]
        return try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }

    /// Whether a call reads premium data. `results:search` does only with
    /// dates: name suggestions are public.
    static func isPremiumCall(_ path: String, args: [String: Any]) -> Bool {
        guard premiumFunctions.contains(path) else { return false }
        return path != "results:search" || (args["startDate"] != nil && args["endDate"] != nil)
    }

    /// `args` with the access pass added, when there is one.
    private static func adding(pass: String?, to args: [String: Any]) -> [String: Any] {
        guard let pass else { return args }
        var withPass = args
        withPass["pass"] = pass
        return withPass
    }

    /// Runs a query. A premium one carries the access pass when Siri can get
    /// one, and goes without it otherwise (answered while the server only
    /// logs such reads). Refused for its pass (status 401 or 403), it is sent
    /// once more with a new pass, as the app does.
    private func fetch(_ path: String, args: [String: Any], bodyData: Data) async throws -> Data {
        guard Self.isPremiumCall(path, args: args) else { return try await post(bodyData) }
        guard let token = SiriToken.stored() else {
            forgetPass()
            return try await post(bodyData)
        }
        let pass = await accessPass(for: token)
        do {
            return try await post(Self.requestBody(path, args: Self.adding(pass: pass, to: args)))
        } catch MeetCalAPIError.functionFailed(let status) where status == 401 || status == 403 {
            guard let fresh = await accessPass(for: token, refused: pass, retry: true), fresh != pass else {
                throw MeetCalAPIError.functionFailed(status: status)
            }
            return try await post(Self.requestBody(path, args: Self.adding(pass: fresh, to: args)))
        }
    }

    // MARK: Access pass

    /// The pass a premium read should carry, for `token`'s user. The held one
    /// is used until it is due for renewal, and past that (the server still
    /// accepts it for a day) while a new one cannot be had; otherwise one is
    /// fetched, once for all the reads waiting on it. `retry` is a read the
    /// server refused for its pass (`refused`, or none): a refused pass is
    /// dropped, unless another read already replaced it, and a new one
    /// fetched. As `accessPassFor` in lib/api/premium-queries.ts.
    private func accessPass(for token: SiriToken, refused: String? = nil, retry: Bool = false) async -> String? {
        if !loadedHeldPass {
            loadedHeldPass = true
            heldPass = Self.persistedPass()
        }
        if let held = heldPass, held.tokenId != token.tokenId || (retry && held.pass == refused) {
            forgetPass()
        }
        if let held = heldPass, retry || Date().timeIntervalSince1970 < held.until {
            return held.pass
        }
        if !retry, Date() < skipPassUntil {
            return heldPass?.pass
        }
        let pending: Task<HeldPass?, Never>
        if let running = passFetch {
            pending = running
        } else {
            pending = Task { await self.fetchPass(with: token) }
            passFetch = pending
        }
        let fetched = await pending.value
        return fetched?.pass ?? heldPass?.pass
    }

    /// Fetches a pass and holds it, or waits `passRetryAfter` before the next try.
    private func fetchPass(with token: SiriToken) async -> HeldPass? {
        let fetched = await requestPass(with: token)
        if let fetched {
            heldPass = fetched
            Self.persist(fetched)
        } else {
            skipPassUntil = Date().addingTimeInterval(Self.passRetryAfter)
        }
        passFetch = nil
        return fetched
    }

    /// `accessPass:pass` with Siri's token. The server answers 403 when it
    /// knows of no active subscription (RevenueCat's webhook lands after a
    /// purchase, and never came for lifetime purchases made before it
    /// existed); then it is asked to check RevenueCat now
    /// (`entitlements:refresh`) and, if it finds the subscription, asked once
    /// more. A 401 means the server no longer accepts the token (revoked, or
    /// its signing key replaced): it is deleted, so the app issues a new one.
    /// Nil when there is no pass to be had.
    private func requestPass(with token: SiriToken) async -> HeldPass? {
        do {
            return try await passAnswer(with: token)
        } catch MeetCalAPIError.functionFailed(let status) where status == 401 {
            // Revoked: the token verifies, but its `api_tokens` row is gone.
            SiriToken.discard(tokenId: token.tokenId)
            return nil
        } catch MeetCalAPIError.badStatus(401) {
            // Convex could not verify the token at all (a replaced signing key).
            SiriToken.discard(tokenId: token.tokenId)
            return nil
        } catch MeetCalAPIError.functionFailed(let status) where status == 403 {
            guard
                let refreshed = try? await post(
                    Self.requestBody("entitlements:refresh", args: [:]),
                    endpoint: "api/action",
                    token: token.token
                ),
                let entitlement = try? JSONDecoder().decode(APIEntitlement.self, from: refreshed),
                entitlement.active
            else { return nil }
            return try? await passAnswer(with: token)
        } catch {
            return nil
        }
    }

    private func passAnswer(with token: SiriToken) async throws -> HeldPass {
        let data = try await post(Self.requestBody("accessPass:pass", args: [:]), token: token.token)
        let answer = try JSONDecoder().decode(APIAccessPass.self, from: data)
        guard !answer.pass.isEmpty else { throw MeetCalAPIError.queryFailed }
        let until = max(answer.rotatesAt / 1000, Date().timeIntervalSince1970 + Self.passMinHold)
        return HeldPass(pass: answer.pass, until: until, tokenId: token.tokenId)
    }

    /// Drops the held pass: signed out, another user's, or refused.
    private func forgetPass() {
        if heldPass != nil || !loadedHeldPass { Self.persist(nil) }
        heldPass = nil
        loadedHeldPass = true
    }

    private static func persistedPass() -> HeldPass? {
        guard let data = UserDefaults.standard.data(forKey: heldPassKey) else { return nil }
        return try? JSONDecoder().decode(HeldPass.self, from: data)
    }

    private static func persist(_ held: HeldPass?) {
        if let held, let data = try? JSONEncoder().encode(held) {
            UserDefaults.standard.set(data, forKey: heldPassKey)
        } else {
            UserDefaults.standard.removeObject(forKey: heldPassKey)
        }
    }

    // MARK: HTTP

    /// POSTs a function call to Convex (`api/query`, or `api/action`) and
    /// returns the answer's JSON payload. `token` signs the call: only the
    /// pass and entitlement calls carry one, never a data query. A function
    /// that ran and failed (Convex answers 560, or 200) throws
    /// `functionFailed` with the status in its `errorData`.
    private func post(_ bodyData: Data, endpoint: String = "api/query", token: String? = nil) async throws -> Data {
        var request = URLRequest(url: convexURL.appendingPathComponent(endpoint))
        request.httpMethod = "POST"
        request.httpBody = bodyData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        let envelope = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if let envelope, envelope["status"] as? String == "error" {
            let errorData = envelope["errorData"] as? [String: Any]
            throw MeetCalAPIError.functionFailed(status: (errorData?["status"] as? NSNumber)?.intValue)
        }
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw MeetCalAPIError.badStatus(http.statusCode)
        }
        guard let envelope, envelope["status"] as? String == "success" else {
            throw MeetCalAPIError.queryFailed
        }
        let value = envelope["value"] ?? NSNull()
        if let object = value as? [String: Any], let text = object["json"] as? String {
            return Data(text.utf8)
        }
        return try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    }

    // MARK: TTL cache (memory + files)

    /// The persisted layer lives in files under the App Group's
    /// `Library/Caches`, not in its `UserDefaults`. Every widget timeline
    /// loads that suite whole into a memory-limited extension, and one roster
    /// answer for a national meet is about 0.5 MB. Caches is also purgeable
    /// by the system, which suits a five-minute cache.
    private static func makeCacheDirectory() -> URL? {
        let fileManager = FileManager.default
        let base = fileManager
            .containerURL(forSecurityApplicationGroupIdentifier: MeetCalShared.appGroupIdentifier)?
            .appendingPathComponent("Library/Caches", isDirectory: true)
            ?? fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
        guard let directory = base?.appendingPathComponent("MeetCalAPI", isDirectory: true) else {
            return nil
        }
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            return directory
        } catch {
            return nil
        }
    }

    /// A request key's file: its SHA-256, so any key is a safe file name.
    private func cacheFileURL(for key: String) -> URL? {
        guard let cacheDirectory else { return nil }
        let digest = SHA256.hash(data: Data(key.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return cacheDirectory.appendingPathComponent(name, isDirectory: false)
    }

    private func cachedData(for key: String) -> Data? {
        if let (ts, data) = memoryCache[key], Date().timeIntervalSince(ts) < ttl {
            return data
        }
        // Fall back to the persisted layer (survives process relaunch between
        // Siri invocations). The file's modification date is the timestamp.
        guard let url = cacheFileURL(for: key),
              let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modified = attributes[.modificationDate] as? Date,
              Date().timeIntervalSince(modified) < ttl,
              let data = try? Data(contentsOf: url) else {
            return nil
        }
        memoryCache[key] = (modified, data)
        return data
    }

    private func storeData(_ data: Data, for key: String) {
        let now = Date()
        memoryCache[key] = (now, data)
        migrateLegacyDefaultsCacheOnce()
        pruneExpiredOnce(now: now)
        guard let url = cacheFileURL(for: key) else { return }
        try? data.write(to: url, options: [.atomic])
    }

    private var pruned = false

    /// Every distinct request leaves a file (each search, each hour of
    /// `meets:list`), so expired files are dropped, once per process.
    private func pruneExpiredOnce(now: Date) {
        guard !pruned, let cacheDirectory else { return }
        pruned = true
        let fileManager = FileManager.default
        guard let files = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return }
        for file in files {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            if now.timeIntervalSince(modified) >= ttl {
                try? fileManager.removeItem(at: file)
            }
        }
    }

    private static let legacyCacheMigratedKey = "apiCacheMovedToFiles"
    private var checkedLegacyCache = false

    /// Earlier builds kept this cache in the App Group `UserDefaults`
    /// (`apiCacheData::…` / `apiCacheTS::…`). Remove those entries once, so
    /// the widget extension stops loading them.
    private func migrateLegacyDefaultsCacheOnce() {
        guard !checkedLegacyCache else { return }
        checkedLegacyCache = true
        let defaults = SharedStore.defaults
        guard !defaults.bool(forKey: Self.legacyCacheMigratedKey) else { return }
        for key in defaults.dictionaryRepresentation().keys
        where key.hasPrefix("apiCacheData::") || key.hasPrefix("apiCacheTS::") {
            defaults.removeObject(forKey: key)
        }
        defaults.set(true, forKey: Self.legacyCacheMigratedKey)
    }
}
