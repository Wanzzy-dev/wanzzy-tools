import * as cheerio from 'cheerio';

class NontonAnimeIDScraper {
  constructor(baseUrl = 'https://s13.nontonanimeid.boats') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'id,en-US;q=0.7,en;q=0.3'
    };
    this.lastNonce = null;
    this.lastAjaxUrl = null;
    this.lastUrl = null;
  }

  async _getSoup(url, params = {}) {
    this.lastUrl = url;
    let finalUrl = url;
    if (Object.keys(params).length > 0) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) {
          v.forEach(val => q.append(`${k}[]`, val));
        } else {
          q.append(k, v);
        }
      }
      finalUrl = `${url}?${q.toString()}`;
    }

    try {
      const response = await fetch(finalUrl, {
        headers: {
          ...this.headers,
          'Referer': this.baseUrl
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      const $ = cheerio.load(html);
      this._extractNonceAndAjaxUrl($);
      return $;
    } catch (error) {
      console.error(`Error fetching/parsing ${finalUrl}:`, error);
      return null;
    }
  }

  _extractNonceAndAjaxUrl($) {
    const scraper = this;
    $('script').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src.startsWith('data:text/javascript;base64,')) {
        try {
          const b64Data = src.split('base64,')[1];
          const decoded = Buffer.from(b64Data, 'base64').toString('utf-8');
          const nonceMatch = decoded.match(/"nonce"\s*:\s*"([^"]+)"/);
          const urlMatch = decoded.match(/"url"\s*:\s*"([^"]+)"/);
          if (nonceMatch) scraper.lastNonce = nonceMatch[1];
          if (urlMatch) scraper.lastAjaxUrl = urlMatch[1].replace(/\\/g, '');
        } catch (e) {
          // ignore
        }
      }
    });
  }

  _parseAnimeCard($, cardEl) {
    const card = $(cardEl);
    const link = card.attr('href') || '';

    const imgTag = card.find('img');
    const image = imgTag.attr('src') || imgTag.attr('data-src') || '';

    let title = '';
    const titleTag = card.find('[class*="title"]');
    if (titleTag.length > 0) {
      const span = titleTag.find('span');
      if (span.length > 0) {
        title = span.attr('data-title-default') || span.text().trim();
      } else {
        title = titleTag.text().trim();
      }
    } else if (imgTag.length > 0) {
      title = imgTag.attr('alt') || '';
    }
    title = title.trim();

    const ratingTag = card.find('.rating, .kotakscore, .as-rating');
    let rating = '';
    if (ratingTag.length > 0) {
      rating = ratingTag.text().replace('⭐', '').trim();
      if (!rating && ratingTag.hasClass('kotakscore')) {
        rating = ratingTag.text().replace(/\n/g, '').trim();
      }
    }

    const typeTag = card.find('.type, .as-type');
    const typeVal = typeTag.length > 0 ? typeTag.text().replace('📺', '').trim() : '';

    const seasonTag = card.find('.season, .as-season');
    const season = seasonTag.length > 0 ? seasonTag.text().replace('📅', '').trim() : '';

    const synopsisTag = card.find('.synopsis, .as-synopsis');
    const synopsis = synopsisTag.length > 0 ? synopsisTag.text().trim() : '';

    let genres = [];
    const genresContainer = card.find('[class*="genres"]');
    if (genresContainer.length > 0) {
      genresContainer.find('.genre-tag, .genre-pill, .as-genre-tag').each((i, el) => {
        genres.push($(el).text().trim());
      });
    } else {
      card.find('.genre-tag, .genre-pill, .as-genre-tag').each((i, el) => {
        genres.push($(el).text().trim());
      });
    }

    return {
      title,
      link,
      image,
      rating,
      type: typeVal,
      season,
      synopsis,
      genres
    };
  }

  async getHome() {
    const $ = await this._getSoup(this.baseUrl);
    if (!$) return {};

    const data = {
      episode_terbaru: [],
      series_terbaru_movie: [],
      series_terbaru_tv: [],
      popular_series_semua: [],
      popular_genre: [],
      top_rating_anime: [],
      series_popular_summer: []
    };

    // 1. Episode Terbaru
    $('#postbaru article.animeseries').each((i, el) => {
      const article = $(el);
      const aTag = article.find('a');
      if (aTag.length > 0) {
        const link = aTag.attr('href') || '';
        const imgTag = aTag.find('img');
        const image = imgTag.attr('src') || '';

        const titleSpan = aTag.find('h3.title span');
        let title = titleSpan.length > 0 ? (titleSpan.attr('data-title-default') || titleSpan.text().trim()) : '';
        if (!title && imgTag.length > 0) {
          title = imgTag.attr('alt') || '';
        }
        title = title.trim();

        const epSpan = aTag.find('span.types.episodes');
        const episode = epSpan.length > 0 ? epSpan.text().trim() : '';

        const statusSpan = aTag.find('span.types.status');
        const status = statusSpan.length > 0 ? statusSpan.text().trim() : '';

        data.episode_terbaru.push({
          title,
          link,
          image,
          episode,
          status
        });
      }
    });

    const parseTabContent = (tabId) => {
      const items = [];
      $(`#${tabId} div.animeseries`).each((i, el) => {
        const article = $(el);
        const aTag = article.find('a');
        if (aTag.length > 0) {
          const link = aTag.attr('href') || '';
          const imgTag = aTag.find('img');
          const image = imgTag.attr('src') || '';

          const titleDiv = aTag.find('div.title');
          let title = '';
          if (titleDiv.length > 0) {
            const titleSpan = titleDiv.find('span');
            title = titleSpan.length > 0 ? (titleSpan.attr('data-title-default') || titleSpan.text().trim()) : titleDiv.text().trim();
          }
          if (!title && imgTag.length > 0) {
            title = imgTag.attr('alt') || '';
          }
          title = title.trim();

          const scoreSpan = aTag.find('span.kotakscore');
          const score = scoreSpan.length > 0 ? scoreSpan.text().replace(/\n/g, '').replace(/ /g, '').replace('⭐', '').trim() : '';

          items.push({
            title,
            link,
            image,
            score
          });
        }
      });
      return items;
    };

    data.series_terbaru_movie = parseTabContent('tab-7');
    data.series_terbaru_tv = parseTabContent('tab-8');
    data.popular_series_semua = parseTabContent('tab-9');
    data.popular_genre = parseTabContent('tab-10');

    // Top Rating Anime
    const sidebar = $('#sidebar_right').length > 0 ? $('#sidebar_right') : $('body');
    let topRatingHeader = null;
    sidebar.find('h3, h2').each((i, el) => {
      if ($(el).text().includes('Top Rating Anime')) {
        topRatingHeader = $(el);
      }
    });
    if (topRatingHeader) {
      const ul = $(topRatingHeader).nextAll('ul.latestepisodes').first();
      if (ul.length > 0) {
        ul.find('li').each((i, el) => {
          const li = $(el);
          const aTag = li.find('a');
          if (aTag.length > 0) {
            const link = aTag.attr('href') || '';
            const lefts = aTag.find('div.lefts');
            const rights = aTag.find('div.rights');

            const title = lefts.length > 0 ? lefts.text().trim() : '';
            const videoNum = rights.length > 0 ? rights.find('span.video').text().trim() : '';

            data.top_rating_anime.push({
              title,
              link,
              episodes_count: videoNum
            });
          }
        });
      }
    }

    // Series Popular Summer
    let popularSummerHeader = null;
    sidebar.find('h3, h2').each((i, el) => {
      if ($(el).text().includes('Series Popular Summer')) {
        popularSummerHeader = $(el);
      }
    });
    if (popularSummerHeader) {
      const kotakbatas = $(popularSummerHeader).nextAll('div.kotakbatas').first();
      if (kotakbatas.length > 0) {
        kotakbatas.find('div.bor').each((i, el) => {
          const aTag = $(el).find('a.popseries');
          if (aTag.length > 0) {
            const link = aTag.attr('href') || '';
            const imgTag = aTag.find('img');
            const image = imgTag.attr('src') || '';
            const title = imgTag.attr('alt') || '';

            data.series_popular_summer.push({
              title: title.trim(),
              link,
              image
            });
          }
        });
      }
    }

    return data;
  }

  async getAnimeList(page = 1, filters = {}) {
    const url = page > 1 ? `${this.baseUrl}/anime/page/${page}/` : `${this.baseUrl}/anime/`;
    const $ = await this._getSoup(url, filters);
    if (!$) return [];

    const results = [];
    const gridContainer = $('div.result');
    if (gridContainer.length > 0) {
      const cards = gridContainer.find('a.as-anime-card');
      if (cards.length > 0) {
        const scraper = this;
        cards.each((i, el) => {
          results.push(scraper._parseAnimeCard($, el));
        });
      } else {
        const listItems = gridContainer.find('div.animeseries');
        const scraper = this;
        listItems.each((i, el) => {
          const aTag = $(el).find('a');
          if (aTag.length > 0) {
            results.push(scraper._parseAnimeCard($, aTag));
          }
        });
      }
    }
    return results;
  }

  async searchAnime(query, page = 1) {
    const url = page > 1 ? `${this.baseUrl}/page/${page}/` : `${this.baseUrl}/`;
    const params = { s: query };
    const $ = await this._getSoup(url, params);
    if (!$) return [];

    const results = [];
    const gridContainer = $('div.result');
    if (gridContainer.length > 0) {
      const cards = gridContainer.find('a.as-anime-card');
      if (cards.length > 0) {
        const scraper = this;
        cards.each((i, el) => {
          results.push(scraper._parseAnimeCard($, el));
        });
      } else {
        const listItems = gridContainer.find('div.animeseries');
        const scraper = this;
        listItems.each((i, el) => {
          const aTag = $(el).find('a');
          if (aTag.length > 0) {
            results.push(scraper._parseAnimeCard($, aTag));
          }
        });
      }
    }
    return results;
  }

  async getOngoingList(page = 1, sort = 'date') {
    const url = page > 1 ? `${this.baseUrl}/ongoing-list/page/${page}/` : `${this.baseUrl}/ongoing-list/`;
    const params = { sort, mode: 'sort' };
    const $ = await this._getSoup(url, params);
    if (!$) return [];

    const results = [];
    const gachaGrid = $('div.gacha-grid');
    if (gachaGrid.length > 0) {
      gachaGrid.find('a.gacha-card').each((i, el) => {
        const card = $(el);
        const link = card.attr('href') || '';

        const imgTag = card.find('img');
        const image = imgTag.attr('src') || '';

        const titleTag = card.find('h3.title');
        let title = titleTag.length > 0 ? titleTag.text().trim() : '';
        if (!title && imgTag.length > 0) {
          title = imgTag.attr('alt') || '';
        }
        title = title.trim();

        const currentEp = card.find('span.current-ep');
        const currentEpText = currentEp.length > 0 ? currentEp.text().trim() : '';

        const totalEp = card.find('span.total-ep');
        const totalEpText = totalEp.length > 0 ? totalEp.text().trim() : '';

        const ratingSpan = card.find('span.skor-angka');
        const rating = ratingSpan.length > 0 ? ratingSpan.text().replace('(', '').replace(')', '').trim() : '';

        const hotTag = card.find('div.hot-tag');
        const isHot = hotTag.length > 0;

        let rarity = '';
        const classes = card.attr('class') || '';
        const match = classes.match(/rarity-(\d+)/);
        if (match) rarity = match[1];

        results.push({
          title,
          link,
          image,
          current_episode: currentEpText,
          total_episodes: totalEpText,
          rating,
          hot: isHot,
          rarity
        });
      });
    }
    return results;
  }

  async getPopularSeries(page = 1) {
    const url = page > 1 ? `${this.baseUrl}/popular-series/page/${page}/` : `${this.baseUrl}/popular-series/`;
    const $ = await this._getSoup(url);
    if (!$) return {};

    const data = {
      tabs: {},
      overall_rank: []
    };

    const tabsNav = $('ul.tabs');
    if (tabsNav.length > 0) {
      const scraper = this;
      tabsNav.find('li.tab-link').each((i, el) => {
        const linkLi = $(el);
        const tabName = linkLi.text().trim();
        const tabId = linkLi.attr('data-tab');
        if (tabName && tabId) {
          data.tabs[tabName] = [];
          const tabContent = $(`#${tabId}`);
          if (tabContent.length > 0) {
            tabContent.find('div.animeseries').each((j, art) => {
              const aTag = $(art).find('a');
              if (aTag.length > 0) {
                data.tabs[tabName].push(scraper._parseAnimeCard($, aTag));
              }
            });
          }
        }
      });
    }

    const rankList = $('ul.rank');
    if (rankList.length > 0) {
      rankList.find('li').each((i, el) => {
        const li = $(el);
        const aTag = li.find('a');
        if (aTag.length > 0) {
          const link = aTag.attr('href') || '';
          const imgTag = aTag.find('img');
          const image = imgTag.attr('src') || '';

          const mid = aTag.find('div.mid');
          let title = '';
          let synopsis = '';
          let genres = [];
          if (mid.length > 0) {
            const h2Tag = mid.find('h2');
            title = h2Tag.length > 0 ? h2Tag.text().trim() : '';
            if (!title && imgTag.length > 0) {
              title = imgTag.attr('alt') || '';
            }
            title = title.trim();

            const pTag = mid.find('p');
            synopsis = pTag.length > 0 ? pTag.text().trim() : '';

            const viewerDiv = mid.find('div.viewer');
            if (viewerDiv.length > 0) {
              const viewerText = viewerDiv.text().replace('Genre :', '').trim();
              genres = viewerText.split(',').map(g => g.trim()).filter(g => g);
            }
          }

          data.overall_rank.push({
            title,
            link,
            image,
            synopsis,
            genres
          });
        }
      });
    }

    return data;
  }

  async getJadwalRilis() {
    const url = `${this.baseUrl}/jadwal-rilis/`;
    const $ = await this._getSoup(url);
    if (!$) return {};

    const data = {
      pengumuman_libur: [],
      perlu_diperhatikan: [],
      perkiraan_rilis_mendatang: [],
      kalender_rilis: {}
    };

    const liburBox = $('div.as-delay-announcements');
    if (liburBox.length > 0) {
      liburBox.find('li').each((i, el) => {
        data.pengumuman_libur.push($(el).text().trim());
      });
    }

    const notesBox = $('div.as-important-notes');
    if (notesBox.length > 0) {
      notesBox.find('li').each((i, el) => {
        data.perlu_diperhatikan.push($(el).text().trim());
      });
    }

    const upcomingBox = $('div.jr-upcoming-box');
    if (upcomingBox.length > 0) {
      upcomingBox.find('div.jr-upcoming-item').each((i, el) => {
        const item = $(el);
        const imgTag = item.find('img');
        const image = imgTag.attr('src') || '';

        const titleSpan = item.find('span.jr-upcoming-title');
        const title = titleSpan.length > 0 ? titleSpan.text().trim() : '';

        const epSpan = item.find('span.jr-upcoming-ep');
        const episodeTime = epSpan.length > 0 ? epSpan.text().trim() : '';

        const timeSpan = item.find('div.jr-upcoming-time');
        const timeLeft = timeSpan.length > 0 ? timeSpan.text().trim() : '';

        data.perkiraan_rilis_mendatang.push({
          title,
          image,
          episode_time: episodeTime,
          time_left: timeLeft
        });
      });
    }

    const days = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
    days.forEach(day => {
      const tabContent = $(`#${day}`);
      if (tabContent.length > 0) {
        const dateText = tabContent.attr('data-date-text') || '';
        data.kalender_rilis[day] = {
          date_text: dateText.trim(),
          series: []
        };

        tabContent.find('a.as-anime-card').each((i, el) => {
          const card = $(el);
          const link = card.attr('href') || '';
          const imgTag = card.find('img');
          const image = imgTag.attr('src') || '';

          const titleTag = card.find('h3.as-anime-title');
          const title = titleTag.length > 0 ? titleTag.text().trim() : '';

          const epText = card.find('span.jr-ep-text');
          const episode = epText.length > 0 ? epText.text().trim() : '';

          const typeBadge = card.find('span.jr-type-badge');
          const typeVal = typeBadge.length > 0 ? typeBadge.text().trim() : '';

          const timeSpan = card.find('span.time-text');
          const timeVal = timeSpan.length > 0 ? timeSpan.text().replace('⏰', '').trim() : '';

          const ratingSpan = card.find('span.rating-text');
          const rating = ratingSpan.length > 0 ? ratingSpan.text().replace('⭐', '').trim() : '';

          const membersSpan = card.find('span.members-text');
          const members = membersSpan.length > 0 ? membersSpan.text().replace('👤', '').trim() : '';

          let genresList = [];
          card.find('span.jr-genre-pill').each((j, gEl) => {
            genresList.push($(gEl).text().trim());
          });

          data.kalender_rilis[day].series.push({
            title,
            link,
            image,
            episode,
            type: typeVal,
            time: timeVal,
            rating,
            members,
            genres: genresList
          });
        });
      }
    });

    return data;
  }

  async getGenresList(sort = 'az') {
    const url = `${this.baseUrl}/genres/`;
    const params = { sort, mode: 'sort' };
    const $ = await this._getSoup(url, params);
    if (!$) return [];

    const results = [];
    const gridContainer = $('div.genre-grid-container');
    if (gridContainer.length > 0) {
      gridContainer.find('a.genre-grid-card').each((i, el) => {
        const card = $(el);
        const link = card.attr('href') || '';
        const slug = link.replace(/\/$/, '').split('/').pop() || '';

        const imgTag = card.find('img');
        const image = imgTag.attr('src') || '';

        const titleTag = card.find('h3.genre-name');
        const name = titleTag.length > 0 ? titleTag.text().trim() : '';

        let totalSeries = '';
        const countSpan = card.find('span[class*="count"]');
        if (countSpan.length > 0) {
          totalSeries = countSpan.text().trim();
        }

        let ongoingSeries = '';
        const ongoingSpan = card.find('span[class*="ongoing"]');
        if (ongoingSpan.length > 0) {
          ongoingSeries = ongoingSpan.text().trim();
        }

        results.push({
          name,
          link,
          slug,
          image,
          total_series: totalSeries,
          ongoing_series: ongoingSeries
        });
      });
    }
    return results;
  }

  async getAnimeDetail(animeUrlOrSlug) {
    const url = animeUrlOrSlug.startsWith('http') ? animeUrlOrSlug : `${this.baseUrl}/anime/${animeUrlOrSlug}/`;
    const $ = await this._getSoup(url);
    if (!$) return {};

    const titleH1 = $('h1.entry-title');
    let title = '';
    if (titleH1.length > 0) {
      const span = titleH1.find('span');
      title = span.length > 0 ? (span.attr('data-title-default') || span.text().trim()) : titleH1.text().replace('Nonton', '').replace('Sub Indo', '').trim();
    }

    let poster = '';
    let score = '';
    let typeVal = '';
    let trailer = '';
    const animeCard = $('div.anime-card');
    if (animeCard.length > 0) {
      const sidebar = animeCard.find('div.anime-card__sidebar');
      if (sidebar.length > 0) {
        const imgTag = sidebar.find('img');
        poster = imgTag.attr('src') || '';

        const scoreDiv = sidebar.find('div.anime-card__score');
        if (scoreDiv.length > 0) {
          const valSpan = scoreDiv.find('span.value');
          score = valSpan.length > 0 ? valSpan.text().trim() : '';
          const typeSpan = scoreDiv.find('span.type');
          typeVal = typeSpan.length > 0 ? typeSpan.text().trim() : '';
        }

        const trailerA = sidebar.find('a.trailerbutton');
        trailer = trailerA.attr('href') || '';
      }
    }

    let details = {};
    let synopsis = '';
    let genres = [];
    if (animeCard.length > 0) {
      const mainInfo = animeCard.find('div.anime-card__main');
      if (mainInfo.length > 0) {
        const detailsUl = mainInfo.find('ul.details-list');
        if (detailsUl.length > 0) {
          detailsUl.find('li').each((i, el) => {
            const li = $(el);
            const labelTag = li.find('strong, span.detail-label');
            if (labelTag.length > 0) {
              const label = labelTag.text().replace(':', '').trim();
              const valText = li.text().replace(labelTag.text(), '').trim();
              details[label] = valText;
            }
          });
        }

        const genresDiv = mainInfo.find('div.anime-card__genres');
        if (genresDiv.length > 0) {
          genresDiv.find('a').each((i, el) => {
            genres.push({
              name: $(el).text().trim(),
              link: $(el).attr('href') || ''
            });
          });
        }

        const synDiv = mainInfo.find('div#tab-synopsis');
        if (synDiv.length > 0) {
          synopsis = synDiv.text().trim();
        }
      }
    }

    let status = '';
    let totalEpisodes = '';
    let episodeDuration = '';
    let season = '';
    let seasonLink = '';
    const quickInfo = $('div.anime-card__quick-info');
    if (quickInfo.length > 0) {
      const statusSpan = quickInfo.find('span[class*="status"]');
      status = statusSpan.length > 0 ? statusSpan.text().trim() : '';

      quickInfo.find('span.info-item').each((i, el) => {
        const text = $(el).text();
        if (text.toLowerCase().includes('episodes')) {
          totalEpisodes = text.trim();
        } else if (text.includes('min') || text.includes('menit')) {
          episodeDuration = text.trim();
        }
      });

      const seasonA = quickInfo.find('span.season a');
      if (seasonA.length > 0) {
        season = seasonA.text().trim();
        seasonLink = seasonA.attr('href') || '';
      }
    }

    let episodes = [];
    const epSection = $('section.anime-card__episode-list-section');
    if (epSection.length > 0) {
      const epItems = epSection.find('div.episode-list-items');
      if (epItems.length > 0) {
        epItems.find('a.episode-item').each((i, el) => {
          const aItem = $(el);
          const link = aItem.attr('href') || '';
          const titleSpan = aItem.find('span.ep-title');
          const epTitle = titleSpan.length > 0 ? titleSpan.text().trim() : '';
          const dateSpan = aItem.find('span.ep-date');
          const epDate = dateSpan.length > 0 ? dateSpan.text().trim() : '';

          episodes.push({
            title: epTitle,
            link,
            date: epDate
          });
        });
      }
    }

    let recommended = [];
    const relatedDiv = $('div.related');
    if (relatedDiv.length > 0) {
      const scraper = this;
      relatedDiv.find('a.as-anime-card').each((i, el) => {
        recommended.push(scraper._parseAnimeCard($, el));
      });
    }

    return {
      title,
      poster,
      score,
      type: typeVal,
      trailer,
      synopsis,
      genres,
      details,
      status,
      total_episodes: totalEpisodes,
      episode_duration: episodeDuration,
      season,
      season_link: seasonLink,
      episodes,
      recommended_series: recommended
    };
  }

  async getStreamingDetail(episodeUrlOrSlug) {
    const url = episodeUrlOrSlug.startsWith('http') ? episodeUrlOrSlug : `${this.baseUrl}/${episodeUrlOrSlug}/`;
    const $ = await this._getSoup(url);
    if (!$) return {};

    const titleH1 = $('h1.entry-title');
    const title = titleH1.length > 0 ? titleH1.text().trim() : '';

    let animeTitle = '';
    let animeLink = '';
    const breadcrumbs = $('nav.breadcrumbs');
    if (breadcrumbs.length > 0) {
      const links = breadcrumbs.find('a').filter((i, el) => $(el).attr('href'));
      if (links.length >= 3) {
        const lastLink = links.last();
        animeTitle = lastLink.text().trim();
        animeLink = lastLink.attr('href') || '';
      } else if (links.length === 2) {
        const lastLink = links.last();
        animeTitle = lastLink.text().trim();
        animeLink = lastLink.attr('href') || '';
      }
    }

    let prevLink = null;
    let nextLink = null;
    let allEpsLink = null;
    const naveps = $('div.naveps');
    if (naveps.length > 0) {
      naveps.find('div.nvs').each((i, el) => {
        const nvs = $(el);
        const aTag = nvs.find('a');
        if (aTag.length > 0) {
          const href = aTag.attr('href') || '';
          const label = aTag.text().toLowerCase();
          if (label.includes('prev')) {
            prevLink = href;
          } else if (label.includes('next')) {
            nextLink = href;
          } else if (label.includes('all') || label.includes('episode')) {
            allEpsLink = href;
          }
        } else if (nvs.hasClass('nvsc')) {
          const aTagC = nvs.find('a');
          if (aTagC.length > 0) {
            allEpsLink = aTagC.attr('href') || '';
          }
        }
      });
    }

    let defaultVideoUrl = '';
    const videoku = $('div#videoku');
    if (videoku.length > 0) {
      const iframe = videoku.find('iframe');
      if (iframe.length > 0) {
        defaultVideoUrl = iframe.attr('src') || iframe.attr('data-src') || '';
      }
    }

    let videoServers = [];
    const playerTabs = $('ul.player');
    if (playerTabs.length > 0) {
      playerTabs.find('li.serverplayer').each((i, el) => {
        const li = $(el);
        const serverName = li.text().trim();
        const postId = li.attr('data-post') || '';
        const serverType = li.attr('data-type') || '';
        const nume = li.attr('data-nume') || '';
        const isActive = li.hasClass('on');

        videoServers.push({
          server_name: serverName,
          post_id: postId,
          server_type: serverType,
          nume: nume,
          is_active: isActive
        });
      });
    }

    let downloadLinks = [];
    const downloadArea = $('div#download_area');
    if (downloadArea.length > 0) {
      const arealinker = downloadArea.find('div#arealinker');
      if (arealinker.length > 0) {
        arealinker.find('div.listlink').each((i, el) => {
          const listlink = $(el);
          const spanTag = listlink.find('span');
          const formatName = spanTag.length > 0 ? spanTag.text().trim() : 'Unknown';

          let links = [];
          listlink.find('a').each((j, aEl) => {
            const aLink = $(aEl);
            links.push({
              label: aLink.text().trim(),
              url: aLink.attr('href') || ''
            });
          });

          downloadLinks.push({
            format: formatName,
            links
          });
        });
      }
    }

    let episodeTerbaru = [];
    const sidebar = $('#sidebar_right').length > 0 ? $('#sidebar_right') : $('body');
    let sidebarLatestHeader = null;
    sidebar.find('h3, h2').each((i, el) => {
      if ($(el).text().includes('Episode Terbaru')) {
        sidebarLatestHeader = $(el);
      }
    });
    if (sidebarLatestHeader) {
      const ul = $(sidebarLatestHeader).nextAll('ul.latestepisodes').first();
      if (ul.length > 0) {
        ul.find('li').each((i, el) => {
          const li = $(el);
          const aTag = li.find('a');
          if (aTag.length > 0) {
            const link = aTag.attr('href') || '';
            const lefts = aTag.find('div.lefts');
            const rights = aTag.find('div.rights');

            const epTitle = lefts.length > 0 ? lefts.text().trim() : '';
            const videoNum = rights.length > 0 ? rights.find('span.video').text().trim() : '';

            episodeTerbaru.push({
              title: epTitle,
              link,
              episode: videoNum
            });
          }
        });
      }
    }

    let seriesPopularSummer = [];
    let sidebarPopHeader = null;
    sidebar.find('h3, h2').each((i, el) => {
      if ($(el).text().includes('Series Popular Summer')) {
        sidebarPopHeader = $(el);
      }
    });
    if (sidebarPopHeader) {
      const relatedGrid = $(sidebarPopHeader).nextAll('div.related').first();
      if (relatedGrid.length > 0) {
        const scraper = this;
        relatedGrid.find('a.as-anime-card').each((i, el) => {
          seriesPopularSummer.push(scraper._parseAnimeCard($, el));
        });
      }
    }

    return {
      title,
      anime_title: animeTitle,
      anime_link: animeLink,
      prev_episode_link: prevLink,
      next_episode_link: nextLink,
      all_episodes_link: allEpsLink,
      default_video_url: defaultVideoUrl,
      video_servers: videoServers,
      download_links: downloadLinks,
      episode_terbaru_sidebar: episodeTerbaru,
      series_popular_summer_sidebar: seriesPopularSummer,
      nonce: this.lastNonce,
      ajax_url: this.lastAjaxUrl
    };
  }

  async getVideoIframe(postId, nume, serverName, nonce = null, ajaxUrl = null) {
    const finalNonce = nonce || this.lastNonce;
    const finalAjaxUrl = ajaxUrl || this.lastAjaxUrl || `${this.baseUrl}/wp-admin/admin-ajax.php`;

    if (!finalNonce) {
      throw new Error("Nonce is required. Scrape a streaming page first.");
    }

    const body = new URLSearchParams();
    body.append('action', 'player_ajax');
    body.append('post', postId);
    body.append('nume', nume);
    body.append('serverName', serverName);
    body.append('nonce', finalNonce);

    const headers = {
      ...this.headers,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': this.baseUrl
    };
    if (this.lastUrl) {
      headers['Referer'] = this.lastUrl;
    }

    try {
      const response = await fetch(finalAjaxUrl, {
        method: 'POST',
        headers,
        body
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      const $ = cheerio.load(html);
      const iframe = $('iframe');
      if (iframe.length > 0) {
        return iframe.attr('src') || iframe.attr('data-src') || '';
      }
      return '';
    } catch (error) {
      console.error(`Error resolving video iframe for ${serverName}:`, error);
      return '';
    }
  }
}

export { NontonAnimeIDScraper };
