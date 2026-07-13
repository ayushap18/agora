#!/usr/bin/env ruby
# frozen_string_literal: true

# AGORA corpus cache manager.
#
# Snapshots Go-scraper pulls to disk (TTL'd, content-addressed by query) and
# replays them into the Convex deployment without touching the network —
# offline-demo insurance and instant corpus refills.
#
#   ruby cache/corpus_cache.rb pull   -q "return to office" [--pages 4]
#   ruby cache/corpus_cache.rb replay -q "return to office"
#   ruby cache/corpus_cache.rb list
#   ruby cache/corpus_cache.rb stats
#   ruby cache/corpus_cache.rb clean  [--max-age-hours 24]
#
# Stdlib only. Cache lives in .corpus-cache/ (gitignored).

require "json"
require "digest"
require "fileutils"
require "net/http"
require "optparse"
require "uri"
require "time"

CACHE_DIR  = File.expand_path("../.corpus-cache", __dir__)
def env_deployment
  ["#{__dir__}/../.env.local", ".env.local"].each do |p|
    next unless File.exist?(p)
    File.foreach(p) do |line|
      return Regexp.last_match(1).strip if line =~ /^VITE_CONVEX_URL=(.+)$/
    end
  end
  "http://127.0.0.1:3210"
end
DEPLOYMENT = ENV.fetch("CONVEX_URL") { env_deployment }
BATCH_MAX  = 400 # stay under the Convex mutation's 500-post cap

def cache_path(query)
  File.join(CACHE_DIR, "#{Digest::SHA1.hexdigest(query.downcase.strip)[0, 12]}.json")
end

def entries
  Dir.glob(File.join(CACHE_DIR, "*.json")).map do |f|
    data = JSON.parse(File.read(f))
    { file: f, query: data["query"], ts: data["ts"].to_i,
      posts: data["posts"].values.sum(&:length) }
  rescue JSON::ParserError
    { file: f, query: "<corrupt>", ts: 0, posts: 0 }
  end
end

def age_str(ts_ms)
  mins = ((Time.now.to_f * 1000 - ts_ms) / 60_000).round
  mins < 60 ? "#{mins}m" : "#{(mins / 60.0).round(1)}h"
end

def pull(query, pages)
  FileUtils.mkdir_p(CACHE_DIR)
  path = cache_path(query)
  ok = system("go", "run", ".", "-q", query, "-pages", pages.to_s,
              "-dump", path, "-no-insert", chdir: File.expand_path("../scraper", __dir__))
  abort "scraper failed" unless ok
  data = JSON.parse(File.read(path))
  puts "cached #{data['posts'].values.sum(&:length)} posts for \"#{query}\" → #{path}"
end

def replay(query)
  path = cache_path(query)
  abort "no cache entry for \"#{query}\" — run pull first" unless File.exist?(path)
  data = JSON.parse(File.read(path))
  uri = URI("#{DEPLOYMENT}/api/mutation")
  total = 0
  data["posts"].each do |platform, posts|
    posts.each_slice(BATCH_MAX) do |batch|
      body = { path: "ingest:insertScraped",
               args: { platform: platform, query: "#{data['query']} (cache)", posts: batch },
               format: "json" }
      res = Net::HTTP.post(uri, body.to_json, "Content-Type" => "application/json")
      abort "convex HTTP #{res.code}: #{res.body[0, 200]}" unless res.code == "200"
      total += batch.length
    end
  end
  puts "replayed #{total} cached posts (#{age_str(data['ts'])} old) into #{DEPLOYMENT} — zero network scraping"
end

def list
  rows = entries.sort_by { |e| -e[:ts] }
  abort "cache empty" if rows.empty?
  rows.each { |e| puts format("%-40s %5d posts  %6s old", "\"#{e[:query]}\"", e[:posts], age_str(e[:ts])) }
end

def stats
  rows = entries
  bytes = rows.sum { |e| File.size(e[:file]) }
  puts "#{rows.length} entries · #{rows.sum { |e| e[:posts] }} posts · #{(bytes / 1024.0).round(1)} KB on disk"
end

def clean(max_age_hours)
  cutoff = Time.now.to_f * 1000 - max_age_hours * 3_600_000
  gone = entries.select { |e| e[:ts] < cutoff }
  gone.each { |e| File.delete(e[:file]) }
  puts "removed #{gone.length} entr#{gone.length == 1 ? 'y' : 'ies'} older than #{max_age_hours}h"
end

opts = { pages: 3, max_age_hours: 24 }
parser = OptionParser.new do |o|
  o.on("-q QUERY", "--query QUERY") { |v| opts[:q] = v }
  o.on("--pages N", Integer) { |v| opts[:pages] = v }
  o.on("--max-age-hours N", Integer) { |v| opts[:max_age_hours] = v }
end
cmd = ARGV.shift
parser.parse!(ARGV)

case cmd
when "pull"   then abort "pull needs -q" unless opts[:q]; pull(opts[:q], opts[:pages])
when "replay" then abort "replay needs -q" unless opts[:q]; replay(opts[:q])
when "list"   then list
when "stats"  then stats
when "clean"  then clean(opts[:max_age_hours])
else puts parser.help.sub("Usage: #{File.basename($0)}",
  "usage: ruby cache/corpus_cache.rb pull|replay|list|stats|clean")
end
