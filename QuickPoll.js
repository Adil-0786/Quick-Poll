(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  var API_BASE = window.QUICKPOLL_API_BASE || "/api";
  var WS_URL = window.QUICKPOLL_WS_URL || deriveWSUrl();
  var AUTH_KEY = "quickpoll_user";
  var BOOKMARK_KEY = "quickpoll_bookmarks";

  var state = {
    polls: [],
    activePoll: null,
    activeResults: [],
    activeComments: [],
    filter: "all",
    search: "",
    ws: null,
    wsRetries: 0
  };

  var els = {
    auth: byId("auth"),
    app: byId("app"),
    loginForm: byId("login-form"),
    loginName: byId("login-username"),
    loginPass: byId("login-password"),
    loginError: byId("login-error"),
    logoutBtn: byId("logout-btn"),
    userName: byId("user-name"),
    pageTitleText: byId("page-title-text"),
    pageSubtitle: byId("page-subtitle"),
    exportBtn: byId("export-btn"),
    navItems: qsa(".nav-item[data-view]"),
    views: qsa(".view"),
    createShortcuts: qsa("[data-action='create-poll']"),

    pollGrid: byId("poll-grid"),
    pollEmpty: byId("poll-empty"),
    pollSearch: byId("poll-search"),
    filterPills: qsa("[data-filter]"),
    statMyPolls: byId("stat-my-polls"),
    statTotalVotes: byId("stat-total-votes"),
    statActive: byId("stat-active"),
    statExpired: byId("stat-expired"),

    createForm: byId("create-poll-form"),
    question: byId("poll-question"),
    optionList: byId("option-list"),
    addOptionBtn: byId("add-option-btn"),
    optionCount: byId("option-count"),
    questionCount: byId("question-count"),
    optionsTextarea: byId("poll-options"),
    createBtn: byId("create-poll-btn"),
    aiPrompt: byId("ai-prompt"),
    aiGenerateBtn: byId("ai-generate-btn"),
    aiStatus: byId("ai-status"),
    voiceQuestionBtn: byId("voice-question-btn"),
    voiceAiBtn: byId("voice-ai-btn"),
    quizToggle: byId("quiz-toggle"),
    expiryToggle: byId("expiry-toggle"),
    anonToggle: byId("anon-toggle"),
    status: byId("status"),
    errors: byId("errors"),

    pollTitle: byId("poll-title"),
    pollMeta: byId("poll-meta"),
    voteList: byId("vote-list"),
    answerStatus: byId("answer-status"),
    duplicateBtn: byId("duplicate-btn"),
    speakResultsBtn: byId("speak-results-btn"),
    shareBtn: byId("share-btn"),
    shareLink: byId("share-link"),
    shareIconBtn: byId("share-icon-btn"),
    copyLinkBtn: byId("copy-link-btn"),
    analyticsVotes: byId("analytics-votes"),
    analyticsOptions: byId("analytics-options"),
    analyticsLeading: byId("analytics-leading"),
    analyticsStatus: byId("analytics-status"),
    barChart: byId("bar-chart"),
    donut: byId("donut"),
    legend: byId("legend"),
    commentInput: byId("comment-input"),
    commentSend: byId("comment-send"),
    commentList: byId("comment-list"),
    commentCount: byId("comment-count"),
    commentEmpty: byId("comment-empty")
  };

  init();

  function init() {
    initAuth();
    initNavigation();
    initCreatePoll();
    initDashboardFilters();
    initDetailActions();
    connectWebSocket();

    window.addEventListener("popstate", function () {
      if (!state.activePoll && !els.app) return;
      var pollId = getPollIdFromUrl();
      if (pollId) {
        loadPoll(pollId);
      } else {
        setActiveView("dashboard");
      }
    });
  }

  function initAuth() {
    if (els.loginForm) {
      els.loginForm.addEventListener("submit", handleLogin);
    }
    if (els.logoutBtn) {
      els.logoutBtn.addEventListener("click", handleLogout);
    }

    var user = loadUser();
    if (user) {
      showApp(user);
    } else {
      showAuth();
    }
  }

  function handleLogin(evt) {
    if (evt && typeof evt.preventDefault === "function") evt.preventDefault();
    setLoginError("");

    var name = (els.loginName && els.loginName.value ? els.loginName.value : "").trim();
    var password = (els.loginPass && els.loginPass.value ? els.loginPass.value : "").trim();

    if (!name || !password) {
      setLoginError("Enter a username and password to continue.");
      return;
    }

    storeUser(name);
    if (els.loginForm) els.loginForm.reset();
    showApp(name);
  }

  function handleLogout() {
    clearUser();
    state.activePoll = null;
    showAuth();
  }

  function showAuth() {
    if (els.auth) els.auth.hidden = false;
    if (els.app) els.app.hidden = true;
  }

  function showApp(name) {
    if (els.auth) els.auth.hidden = true;
    if (els.app) els.app.hidden = false;
    if (els.userName) els.userName.textContent = name || "Guest";

    loadPolls().then(function () {
      var pollId = getPollIdFromUrl();
      if (pollId) {
        loadPoll(pollId);
      } else {
        setActiveView("dashboard");
      }
    });
  }

  function initNavigation() {
    els.navItems.forEach(function (item) {
      item.addEventListener("click", onNavClick);
    });

    els.createShortcuts.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setActiveView("create");
      });
    });
  }

  function onNavClick(evt) {
    var view = evt.currentTarget.getAttribute("data-view");
    if (view) {
      if (view === "detail" && !state.activePoll) {
        if (state.polls.length > 0) {
          loadPoll(state.polls[0].id);
          updateUrlForPoll(state.polls[0].id);
          return;
        }
        setActiveView("dashboard");
        return;
      }
      setActiveView(view);
    }
  }

  function setActiveView(view) {
    els.views.forEach(function (section) {
      var isActive = section.getAttribute("data-view") === view;
      section.hidden = !isActive;
      if (isActive) updateHeader(section);
    });

    els.navItems.forEach(function (item) {
      var active = item.getAttribute("data-view") === view;
      if (active) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });
  }

  function updateHeader(section) {
    if (!section) return;
    var title = section.getAttribute("data-title") || "QuickPoll";
    var subtitle = section.getAttribute("data-subtitle") || "";
    var showUser = section.getAttribute("data-show-user") === "true";
    var allowExport = section.getAttribute("data-export") === "true";
    if (els.pageTitleText) els.pageTitleText.textContent = title;
    if (els.pageSubtitle) els.pageSubtitle.textContent = subtitle;
    if (els.userName) els.userName.style.display = showUser ? "inline" : "none";
    if (els.exportBtn) els.exportBtn.hidden = !allowExport;
  }

  function initCreatePoll() {
    if (els.createForm) {
      els.createForm.addEventListener("submit", onCreatePoll);
    }
    if (els.createBtn) {
      els.createBtn.addEventListener("click", onCreatePoll);
    }
    if (els.addOptionBtn) {
      els.addOptionBtn.addEventListener("click", function (evt) {
        if (evt && typeof evt.preventDefault === "function") evt.preventDefault();
        addOptionInput();
      });
    }
    if (els.question) {
      els.question.addEventListener("input", updateQuestionCount);
      updateQuestionCount();
    }
    if (els.aiGenerateBtn) {
      els.aiGenerateBtn.addEventListener("click", onGenerateAI);
    }
    if (els.voiceQuestionBtn) {
      els.voiceQuestionBtn.addEventListener("click", function () {
        startDictation(function (text) {
          if (els.question) {
            els.question.value = text;
            updateQuestionCount();
          }
        }, setError);
      });
    }
    if (els.voiceAiBtn) {
      els.voiceAiBtn.addEventListener("click", function () {
        startDictation(function (text) {
          if (els.aiPrompt) {
            els.aiPrompt.value = text;
          }
        }, setAiStatus);
      });
    }
    updateOptionCount();
  }

  function addOptionInput() {
    if (!els.optionList) return;
    var inputs = els.optionList.querySelectorAll("[data-option-input]");
    var count = inputs.length;
    if (count >= 6) return;

    var row = document.createElement("div");
    row.className = "option-row";

    var picker = document.createElement("label");
    picker.className = "correct-picker";

    var radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "correct-option";
    radio.setAttribute("data-correct-input", "true");

    var badge = document.createElement("span");
    badge.className = "option-badge";
    badge.textContent = String.fromCharCode(65 + count);

    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Option " + (count + 1);
    input.setAttribute("data-option-input", "true");

    picker.appendChild(radio);
    row.appendChild(picker);
    row.appendChild(badge);
    row.appendChild(input);
    els.optionList.appendChild(row);
    updateOptionCount();
    return row;
  }

  function updateOptionCount() {
    if (!els.optionList || !els.optionCount) return;
    var inputs = els.optionList.querySelectorAll("[data-option-input]");
    els.optionCount.textContent = inputs.length + "/6";
  }

  function updateQuestionCount() {
    if (!els.question || !els.questionCount) return;
    var length = (els.question.value || "").length;
    els.questionCount.textContent = length + "/200";
  }

  function collectOptionInputs() {
    var values = [];
    var correctOptionId = "";
    if (els.optionList) {
      var rows = els.optionList.querySelectorAll(".option-row");
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var input = row.querySelector("[data-option-input]");
        var radio = row.querySelector("[data-correct-input]");
        var value = (input && input.value ? input.value : "").trim();
        var isCorrect = radio && radio.checked;
        if (value) {
          values.push(value);
          if (isCorrect) {
            correctOptionId = String(values.length);
          }
        }
      }
    }
    if (els.optionsTextarea) {
      els.optionsTextarea.value = values.join("\n");
    }
    return { options: values, correctOptionId: correctOptionId };
  }

  function onCreatePoll(evt) {
    if (evt && typeof evt.preventDefault === "function") evt.preventDefault();
    setError("");
    setStatus("");

    var question = (els.question && els.question.value ? els.question.value : "").trim();
    var collected = collectOptionInputs();
    var options = collected.options;

    if (!question) {
      setError("Please enter a question.");
      return;
    }
    if (options.length < 2) {
      setError("Add at least two options.");
      return;
    }

    var isQuiz = els.quizToggle ? els.quizToggle.checked : true;
    if (isQuiz && !collected.correctOptionId) {
      setError("Select the correct answer.");
      return;
    }

    var expiresAt = null;
    if (els.expiryToggle && els.expiryToggle.checked) {
      expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    }

    var payload = {
      question: question,
      options: options,
      createdBy: loadUser() || "Guest",
      expiresAt: expiresAt,
      isQuiz: isQuiz,
      correctOptionId: isQuiz ? collected.correctOptionId : null
    };

    apiPost("/poll", payload)
      .then(function (data) {
        if (!data || !data.poll) return;
        state.activePoll = data.poll;
        state.activeResults = data.results || [];
        state.activeComments = data.comments || [];
        upsertPollSummary(data.poll, data.results);
        renderDashboard();
        renderDetail();
        resetCreateForm();
        setStatus("Poll created.");
        setActiveView("detail");
        updateUrlForPoll(data.poll.id);
        subscribeToPoll(data.poll.id);
      })
      .catch(function (err) {
        setError(err.message || "Failed to create poll.");
      });
  }

  function resetCreateForm() {
    if (els.question) els.question.value = "";
    if (els.optionList) {
      els.optionList.innerHTML = "";
      for (var i = 0; i < 2; i++) addOptionInput();
    }
    var firstCorrect = qs("[data-correct-input]", els.optionList);
    if (firstCorrect) firstCorrect.checked = true;
    if (els.expiryToggle) els.expiryToggle.checked = false;
    if (els.anonToggle) els.anonToggle.checked = false;
    updateQuestionCount();
    updateOptionCount();
  }

  function onGenerateAI() {
    if (!els.aiPrompt) return;
    var prompt = (els.aiPrompt.value || "").trim();
    if (!prompt) {
      setAiStatus("Enter a prompt first.");
      return;
    }

    setAiStatus("Generating...");
    if (els.aiGenerateBtn) els.aiGenerateBtn.disabled = true;

    apiPost("/ai/generate-poll", {
      prompt: prompt,
      maxOptions: 4,
      isQuiz: els.quizToggle ? els.quizToggle.checked : true
    })
      .then(function (data) {
        if (!data) return;
        if (els.question && data.question) {
          els.question.value = data.question;
          updateQuestionCount();
        }
        if (Array.isArray(data.options) && data.options.length) {
          fillOptions(data.options, data.correctOptionId);
        }
        var status = data.fallback ? "Generated (fallback mode)." : "Generated.";
        if (!data.fallback && data.provider) {
          status = "Generated (" + data.provider + ").";
        }
        setAiStatus(status);
      })
      .catch(function (err) {
        setAiStatus(err.message || "AI generation failed.");
      })
      .finally(function () {
        if (els.aiGenerateBtn) els.aiGenerateBtn.disabled = false;
      });
  }

  function fillOptions(options, correctOptionId) {
    if (!els.optionList) return;
    els.optionList.innerHTML = "";
    options.forEach(function (opt, idx) {
      var row = addOptionInput();
      var input = row.querySelector("[data-option-input]");
      if (input) input.value = opt;
      var radio = row.querySelector("[data-correct-input]");
      if (radio && correctOptionId && String(idx + 1) === String(correctOptionId)) {
        radio.checked = true;
      }
    });
    if (!correctOptionId) {
      var first = qs("[data-correct-input]", els.optionList);
      if (first) first.checked = true;
    }
    updateOptionCount();
  }

  function setAiStatus(message) {
    if (els.aiStatus) {
      els.aiStatus.textContent = message || "";
    }
  }

  function startDictation(onResult, onError) {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (typeof onError === "function") onError("Voice input is not supported in this browser.");
      return;
    }
    var recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = function (event) {
      if (!event.results || !event.results[0] || !event.results[0][0]) return;
      var transcript = event.results[0][0].transcript;
      if (typeof onResult === "function") onResult(transcript);
    };
    recognition.onerror = function (event) {
      if (typeof onError === "function") onError(event.error || "Voice input failed.");
    };
    recognition.start();
  }

  function initDashboardFilters() {
    if (els.pollSearch) {
      els.pollSearch.addEventListener("input", function (evt) {
        state.search = evt.target.value || "";
        renderDashboard();
      });
    }

    els.filterPills.forEach(function (pill) {
      pill.addEventListener("click", function () {
        els.filterPills.forEach(function (p) {
          p.classList.remove("active");
        });
        pill.classList.add("active");
        state.filter = pill.getAttribute("data-filter") || "all";
        renderDashboard();
      });
    });

    if (els.pollGrid) {
      els.pollGrid.addEventListener("click", onPollGridClick);
    }
  }

  function onPollGridClick(evt) {
    var actionBtn = evt.target.closest(".icon-btn");
    if (actionBtn) {
      evt.stopPropagation();
      var action = actionBtn.getAttribute("data-action");
      var pollId = actionBtn.getAttribute("data-poll-id");
      if (!pollId) return;
      if (action === "bookmark") toggleBookmark(pollId);
      if (action === "duplicate") duplicatePoll(pollId);
      if (action === "delete") deletePoll(pollId);
      return;
    }

    var card = evt.target.closest(".poll-card");
    if (!card) return;
    var id = card.getAttribute("data-poll-id");
    if (id) {
      loadPoll(id);
      updateUrlForPoll(id);
    }
  }

  function renderDashboard() {
    if (!els.pollGrid) return;

    var list = state.polls.slice();

    if (state.search) {
      var term = state.search.toLowerCase();
      list = list.filter(function (poll) {
        return poll.question.toLowerCase().indexOf(term) !== -1;
      });
    }

    if (state.filter === "active") {
      list = list.filter(function (poll) {
        return !isExpired(poll);
      });
    } else if (state.filter === "expired") {
      list = list.filter(function (poll) {
        return isExpired(poll);
      });
    } else if (state.filter === "popular") {
      list = list.sort(function (a, b) {
        return b.totalVotes - a.totalVotes;
      });
    } else if (state.filter === "bookmarked") {
      var bookmarks = getBookmarks();
      list = list.filter(function (poll) {
        return bookmarks.indexOf(poll.id) !== -1;
      });
    }

    els.pollGrid.innerHTML = "";
    if (list.length === 0) {
      if (els.pollEmpty) els.pollEmpty.hidden = false;
    } else {
      if (els.pollEmpty) els.pollEmpty.hidden = true;
    }

    list.forEach(function (poll) {
      var card = document.createElement("article");
      card.className = "poll-card";
      card.setAttribute("data-poll-id", poll.id);

      var header = document.createElement("div");
      header.className = "poll-card-header";

      var badge = document.createElement("span");
      badge.className = "badge " + (isExpired(poll) ? "info" : "success");
      badge.textContent = isExpired(poll) ? "Expired" : "Active";

      var actions = document.createElement("div");
      actions.className = "card-actions";

      var bookmark = document.createElement("button");
      bookmark.className = "icon-btn";
      bookmark.setAttribute("type", "button");
      bookmark.setAttribute("data-action", "bookmark");
      bookmark.setAttribute("data-poll-id", poll.id);
      if (isBookmarked(poll.id)) bookmark.classList.add("active");

      var duplicate = document.createElement("button");
      duplicate.className = "icon-btn";
      duplicate.setAttribute("type", "button");
      duplicate.setAttribute("data-action", "duplicate");
      duplicate.setAttribute("data-poll-id", poll.id);

      var remove = document.createElement("button");
      remove.className = "icon-btn";
      remove.setAttribute("type", "button");
      remove.setAttribute("data-action", "delete");
      remove.setAttribute("data-poll-id", poll.id);

      actions.appendChild(bookmark);
      actions.appendChild(duplicate);
      actions.appendChild(remove);

      header.appendChild(badge);
      header.appendChild(actions);

      var title = document.createElement("h3");
      title.textContent = poll.question;

      var meta = document.createElement("div");
      meta.className = "poll-meta";
      var votes = document.createElement("span");
      votes.textContent = poll.totalVotes + " votes";
      var options = document.createElement("span");
      options.textContent = poll.optionsCount + " options";
      meta.appendChild(votes);
      meta.appendChild(options);

      card.appendChild(header);
      card.appendChild(title);
      card.appendChild(meta);
      els.pollGrid.appendChild(card);
    });

    updateStats();
  }

  function updateStats() {
    if (!els.statMyPolls) return;
    var totalVotes = 0;
    var active = 0;
    var expired = 0;
    state.polls.forEach(function (poll) {
      totalVotes += poll.totalVotes || 0;
      if (isExpired(poll)) {
        expired += 1;
      } else {
        active += 1;
      }
    });

    els.statMyPolls.textContent = state.polls.length;
    if (els.statTotalVotes) els.statTotalVotes.textContent = totalVotes;
    if (els.statActive) els.statActive.textContent = active;
    if (els.statExpired) els.statExpired.textContent = expired;
  }

  function initDetailActions() {
    if (els.voteList) {
      els.voteList.addEventListener("click", onVoteClick);
    }
    if (els.exportBtn) {
      els.exportBtn.addEventListener("click", exportCsv);
    }
    if (els.duplicateBtn) {
      els.duplicateBtn.addEventListener("click", function () {
        if (state.activePoll) duplicatePoll(state.activePoll.id);
      });
    }
    if (els.speakResultsBtn) {
      els.speakResultsBtn.addEventListener("click", speakResults);
    }
    if (els.shareBtn) {
      els.shareBtn.addEventListener("click", sharePoll);
    }
    if (els.copyLinkBtn) {
      els.copyLinkBtn.addEventListener("click", copyShareLink);
    }
    if (els.shareIconBtn) {
      els.shareIconBtn.addEventListener("click", sharePoll);
    }
    if (els.commentSend) {
      els.commentSend.addEventListener("click", submitComment);
    }
    if (els.commentInput) {
      els.commentInput.addEventListener("keydown", function (evt) {
        if (evt.key === "Enter") {
          evt.preventDefault();
          submitComment();
        }
      });
    }
  }

  function onVoteClick(evt) {
    var row = evt.target.closest(".vote-row");
    if (!row || !state.activePoll) return;
    var optionId = row.getAttribute("data-option-id");
    if (!optionId) return;
    if (hasVoted(state.activePoll.id)) return;

    apiPost("/vote", { pollId: state.activePoll.id, optionId: optionId })
      .then(function (data) {
        if (!data || !data.results) return;
        lockVote(state.activePoll.id, optionId);
        if (data.correctOptionId) {
          state.activePoll.correctOptionId = String(data.correctOptionId);
        }
        if (typeof data.correct === "boolean") {
          saveAnswer(state.activePoll.id, optionId, data.correctOptionId, data.correct);
        }
        state.activeResults = data.results;
        updatePollSummaryVotes(state.activePoll.id, data.results);
        renderDetail();
        renderDashboard();
      })
      .catch(function () {});
  }

  function submitComment() {
    if (!state.activePoll || !els.commentInput) return;
    var text = (els.commentInput.value || "").trim();
    if (!text) return;

    apiPost("/comment", {
      pollId: state.activePoll.id,
      text: text,
      author: loadUser() || "Guest"
    })
      .then(function (data) {
        if (!data || !data.comments) return;
        state.activeComments = data.comments;
        if (els.commentInput) els.commentInput.value = "";
        renderComments();
      })
      .catch(function () {});
  }

  function exportCsv() {
    if (!state.activePoll) return;
    var url = API_BASE + "/poll/" + state.activePoll.id + "/export";
    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("Export failed");
        return res.text();
      })
      .then(function (text) {
        downloadFile("poll-" + state.activePoll.id + ".csv", text);
      })
      .catch(function () {});
  }

  function copyShareLink() {
    if (!state.activePoll || !els.shareLink) return;
    var link = els.shareLink.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link);
    } else {
      fallbackCopy(link);
    }
  }

  function sharePoll() {
    if (!state.activePoll) return;
    var link = buildShareLink(state.activePoll.id);
    var title = state.activePoll.question || "QuickPoll";
    var text = "Vote on this poll.";
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: link });
    } else {
      copyShareLink();
    }
  }

  function speakResults() {
    if (!state.activePoll || !window.speechSynthesis) return;
    var total = getResultsTotal(state.activeResults);
    var text = "Poll question: " + state.activePoll.question + ". ";
    state.activeResults.forEach(function (row) {
      text += row.text + ": " + row.votes + " votes. ";
    });
    if (state.activePoll.isQuiz) {
      var answer = getAnswerRecord(state.activePoll.id);
      if (answer && answer.correctOptionId) {
        text += "Correct answer is " + getOptionText(answer.correctOptionId) + ". ";
      }
    }
    text += "Total votes " + total + ".";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function renderDetail() {
    if (!state.activePoll) return;
    if (els.pollTitle) els.pollTitle.textContent = state.activePoll.question;

    var totalVotes = getResultsTotal(state.activeResults);
    if (els.pollMeta) {
      var author = state.activePoll.createdBy || "Guest";
      els.pollMeta.textContent = "by " + author + " - " + totalVotes + " votes";
    }

    if (els.shareLink) {
      els.shareLink.textContent = buildShareLink(state.activePoll.id);
    }

    renderVoteList();
    renderAnswerStatus();
    renderCharts();
    renderAnalytics();
    renderComments();
  }

  function renderVoteList() {
    if (!els.voteList) return;
    els.voteList.innerHTML = "";
    var total = getResultsTotal(state.activeResults);
    var answer = getAnswerRecord(state.activePoll.id);
    var selectedOption = answer ? answer.selectedOptionId : getVotedOption(state.activePoll.id);
    var correctOption = "";
    if (state.activePoll.isQuiz && answer) {
      correctOption = state.activePoll.correctOptionId || answer.correctOptionId || "";
    }

    state.activeResults.forEach(function (row, index) {
      var item = document.createElement("div");
      item.className = "vote-row";
      item.setAttribute("data-option-id", row.optionId);
      if (correctOption && row.optionId === correctOption) {
        item.classList.add("correct");
      }
      if (selectedOption && row.optionId === selectedOption) {
        item.classList.add("active");
        if (correctOption && row.optionId !== correctOption) {
          item.classList.add("wrong");
        }
      }

      var label = document.createElement("div");
      label.className = "vote-label";

      var badge = document.createElement("span");
      badge.className = "option-pill";
      badge.textContent = String.fromCharCode(65 + index);

      var text = document.createElement("span");
      text.textContent = row.text;

      label.appendChild(badge);
      label.appendChild(text);

      var percent = document.createElement("span");
      percent.className = "vote-percent";
      percent.textContent = total > 0 ? Math.round((row.votes / total) * 100) + "%" : "0%";

      item.appendChild(label);
      item.appendChild(percent);
      els.voteList.appendChild(item);
    });
  }

  function renderAnswerStatus() {
    if (!els.answerStatus || !state.activePoll) return;
    if (!state.activePoll.isQuiz) {
      els.answerStatus.textContent = "";
      els.answerStatus.className = "answer-status";
      return;
    }
    var answer = getAnswerRecord(state.activePoll.id);
    if (!answer || typeof answer.isCorrect !== "boolean") {
      els.answerStatus.textContent = "";
      els.answerStatus.className = "answer-status";
      return;
    }
    var correctText = getOptionText(answer.correctOptionId);
    if (answer.isCorrect) {
      els.answerStatus.textContent = "Correct answer.";
      els.answerStatus.className = "answer-status success";
    } else {
      els.answerStatus.textContent = "Incorrect." + (correctText ? " Correct answer: " + correctText + "." : "");
      els.answerStatus.className = "answer-status error";
    }
  }

  function renderCharts() {
    if (!els.barChart || !els.donut || !els.legend) return;
    var total = getResultsTotal(state.activeResults);
    var colors = ["#c084fc", "#60a5fa", "#34d399", "#f59e0b", "#fb7185", "#a855f7"];

    els.barChart.innerHTML = "";
    els.legend.innerHTML = "";

    var conicParts = [];
    var currentDeg = 0;

    state.activeResults.forEach(function (row, index) {
      var pct = total > 0 ? (row.votes / total) * 100 : 0;
      var height = Math.max(pct, 4);
      var bar = document.createElement("div");
      bar.className = "bar";
      bar.style.setProperty("--h", height + "%");

      var label = document.createElement("span");
      label.textContent = row.text.slice(0, 8);
      bar.appendChild(label);
      els.barChart.appendChild(bar);

      var color = colors[index % colors.length];
      var degrees = (pct / 100) * 360;
      conicParts.push(color + " " + currentDeg + "deg " + (currentDeg + degrees) + "deg");
      currentDeg += degrees;

      var legendItem = document.createElement("span");
      legendItem.className = "legend-item";
      var dot = document.createElement("i");
      dot.className = "dot";
      dot.style.background = color;
      legendItem.appendChild(dot);
      legendItem.appendChild(document.createTextNode(row.text));
      els.legend.appendChild(legendItem);
    });

    if (conicParts.length === 0) {
      conicParts = ["#2d3245 0deg 360deg"];
    } else if (currentDeg < 360) {
      conicParts.push("#2d3245 " + currentDeg + "deg 360deg");
    }
    els.donut.style.background = "conic-gradient(" + conicParts.join(", ") + ")";
  }

  function renderAnalytics() {
    if (!els.analyticsVotes) return;
    var total = getResultsTotal(state.activeResults);
    els.analyticsVotes.textContent = total;
    if (els.analyticsOptions) els.analyticsOptions.textContent = state.activePoll.options.length;
    if (els.analyticsLeading) {
      var leading = getLeadingOption(state.activeResults);
      els.analyticsLeading.textContent = leading ? leading.text : "-";
    }
    if (els.analyticsStatus) {
      els.analyticsStatus.textContent = isExpired(state.activePoll) ? "Expired" : "Active";
    }
  }

  function renderComments() {
    if (!els.commentList || !els.commentCount) return;
    els.commentList.innerHTML = "";
    els.commentCount.textContent = state.activeComments.length;

    if (els.commentEmpty) {
      els.commentEmpty.hidden = state.activeComments.length > 0;
    }

    state.activeComments.forEach(function (comment) {
      var item = document.createElement("div");
      item.className = "comment-item";

      var text = document.createElement("div");
      text.textContent = comment.text;
      var meta = document.createElement("div");
      meta.className = "comment-meta";
      meta.textContent = comment.author + " - " + formatTime(comment.createdAt);

      item.appendChild(text);
      item.appendChild(meta);
      els.commentList.appendChild(item);
    });
  }

  function loadPolls() {
    return apiGet("/polls")
      .then(function (data) {
        state.polls = data.polls || [];
        renderDashboard();
      })
      .catch(function () {});
  }

  function loadPoll(pollId) {
    if (!pollId) return;
    apiGet("/poll/" + pollId)
      .then(function (data) {
        if (!data || !data.poll) return;
        state.activePoll = data.poll;
        state.activeResults = data.results || [];
        state.activeComments = data.comments || [];
        upsertPollSummary(data.poll, data.results);
        renderDashboard();
        renderDetail();
        setActiveView("detail");
        subscribeToPoll(data.poll.id);
      })
      .catch(function () {
        setActiveView("dashboard");
      });
  }

  function duplicatePoll(pollId) {
    apiPost("/duplicate", { pollId: pollId })
      .then(function (data) {
        if (!data || !data.poll) return;
        state.activePoll = data.poll;
        state.activeResults = data.results || [];
        state.activeComments = data.comments || [];
        upsertPollSummary(data.poll, data.results);
        renderDashboard();
        renderDetail();
        setActiveView("detail");
        updateUrlForPoll(data.poll.id);
        subscribeToPoll(data.poll.id);
      })
      .catch(function () {});
  }

  function deletePoll(pollId) {
    if (!pollId) return;
    if (!window.confirm("Delete this poll?")) return;
    apiDelete("/poll/" + pollId)
      .then(function () {
        state.polls = state.polls.filter(function (poll) {
          return poll.id !== pollId;
        });
        if (state.activePoll && state.activePoll.id === pollId) {
          state.activePoll = null;
          state.activeResults = [];
          state.activeComments = [];
          updateUrlForPoll("");
          setActiveView("dashboard");
        }
        renderDashboard();
      })
      .catch(function () {});
  }

  function upsertPollSummary(poll, results) {
    var existing = state.polls.find(function (item) {
      return item.id === poll.id;
    });
    var totalVotes = results ? getResultsTotal(results) : 0;
    var summary = {
      id: poll.id,
      question: poll.question,
      optionsCount: poll.options.length,
      totalVotes: totalVotes,
      createdAt: poll.createdAt,
      expiresAt: poll.expiresAt || null,
      createdBy: poll.createdBy || "Guest"
    };

    if (existing) {
      Object.assign(existing, summary);
    } else {
      state.polls.unshift(summary);
    }
  }

  function updatePollSummaryVotes(pollId, results) {
    var summary = state.polls.find(function (item) {
      return item.id === pollId;
    });
    if (!summary) return;
    summary.totalVotes = getResultsTotal(results);
  }

  function apiGet(path) {
    return fetch(API_BASE + path).then(handleJson);
  }

  function apiPost(path, payload) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    }).then(handleJson);
  }

  function apiDelete(path) {
    return fetch(API_BASE + path, { method: "DELETE" }).then(handleJson);
  }

  function handleJson(res) {
    if (!res.ok) {
      return res.text().then(function (text) {
        throw new Error(text || "Request failed.");
      });
    }
    return res.json();
  }

  function setStatus(message) {
    if (els.status) els.status.textContent = message || "";
  }

  function setError(message) {
    if (els.errors) els.errors.textContent = message || "";
  }

  function setLoginError(message) {
    if (els.loginError) els.loginError.textContent = message || "";
  }

  function storeUser(name) {
    if (!window.localStorage) return;
    try {
      window.localStorage.setItem(AUTH_KEY, name);
    } catch (err) {
      // ignore
    }
  }

  function loadUser() {
    if (!window.localStorage) return "";
    try {
      return window.localStorage.getItem(AUTH_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function clearUser() {
    if (!window.localStorage) return;
    try {
      window.localStorage.removeItem(AUTH_KEY);
    } catch (err) {
      // ignore
    }
  }

  function getBookmarks() {
    if (!window.localStorage) return [];
    try {
      var raw = window.localStorage.getItem(BOOKMARK_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function toggleBookmark(pollId) {
    var bookmarks = getBookmarks();
    var index = bookmarks.indexOf(pollId);
    if (index === -1) {
      bookmarks.push(pollId);
    } else {
      bookmarks.splice(index, 1);
    }
    try {
      window.localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
    } catch (err) {
      // ignore
    }
    renderDashboard();
  }

  function isBookmarked(pollId) {
    return getBookmarks().indexOf(pollId) !== -1;
  }

  function hasVoted(pollId) {
    if (!window.localStorage) return false;
    try {
      return window.localStorage.getItem("quickpoll_voted_" + pollId) === "1";
    } catch (err) {
      return false;
    }
  }

  function lockVote(pollId, optionId) {
    if (!window.localStorage) return;
    try {
      window.localStorage.setItem("quickpoll_voted_" + pollId, "1");
      window.localStorage.setItem("quickpoll_vote_option_" + pollId, optionId || "");
    } catch (err) {
      // ignore
    }
  }

  function getVotedOption(pollId) {
    if (!window.localStorage) return "";
    try {
      return window.localStorage.getItem("quickpoll_vote_option_" + pollId) || "";
    } catch (err) {
      return "";
    }
  }

  function saveAnswer(pollId, selectedOptionId, correctOptionId, isCorrect) {
    if (!window.localStorage) return;
    try {
      var payload = {
        selectedOptionId: selectedOptionId || "",
        correctOptionId: correctOptionId || "",
        isCorrect: !!isCorrect
      };
      window.localStorage.setItem("quickpoll_answer_" + pollId, JSON.stringify(payload));
    } catch (err) {
      // ignore
    }
  }

  function getAnswerRecord(pollId) {
    if (!window.localStorage) return null;
    try {
      var raw = window.localStorage.getItem("quickpoll_answer_" + pollId);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function getOptionText(optionId) {
    if (!optionId) return "";
    var row = state.activeResults.find(function (item) {
      return String(item.optionId) === String(optionId);
    });
    return row ? row.text : "";
  }

  function getResultsTotal(results) {
    return results.reduce(function (sum, row) {
      return sum + (row.votes || 0);
    }, 0);
  }

  function getLeadingOption(results) {
    if (!results.length) return null;
    return results.reduce(function (max, row) {
      return row.votes > max.votes ? row : max;
    }, results[0]);
  }

  function isExpired(poll) {
    return poll.expiresAt && Date.now() > poll.expiresAt;
  }

  function getPollIdFromUrl() {
    var path = window.location.pathname || "";
    var match = path.match(/\/poll\/([^/]+)/);
    if (match && match[1]) return match[1];
    var params = new URLSearchParams(window.location.search || "");
    return params.get("poll") || "";
  }

  function updateUrlForPoll(pollId) {
    if (!window.history || !window.history.pushState) return;
    if (!pollId) {
      window.history.pushState({}, "", "/");
      return;
    }
    window.history.pushState({}, "", "/poll/" + pollId);
  }

  function buildShareLink(pollId) {
    var origin = window.location.origin || "";
    if (origin === "null" || !origin) {
      return window.location.href.split("#")[0].split("?")[0] + "?poll=" + pollId;
    }
    return origin + "/poll/" + pollId;
  }

  function downloadFile(name, content) {
    var blob = new Blob([content], { type: "text/csv" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function fallbackCopy(text) {
    var input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand("copy");
    } catch (err) {
      // ignore
    }
    input.remove();
  }

  function formatTime(timestamp) {
    if (!timestamp) return "just now";
    var date = new Date(timestamp);
    return date.toLocaleString();
  }

  function connectWebSocket() {
    if (!WS_URL) return;
    try {
      state.ws = new WebSocket(WS_URL);
    } catch (err) {
      return;
    }

    state.ws.addEventListener("open", function () {
      state.wsRetries = 0;
      if (state.activePoll) subscribeToPoll(state.activePoll.id);
    });

    state.ws.addEventListener("message", function (event) {
      var data;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        return;
      }

      if (!data || !data.pollId) return;
      if (state.activePoll && String(data.pollId) !== String(state.activePoll.id)) return;

      if (data.type === "poll" && data.poll) {
        state.activePoll = data.poll;
      }
      if (data.type === "results" && data.results) {
        state.activeResults = data.results;
      }
      if (data.type === "comments" && data.comments) {
        state.activeComments = data.comments;
      }

      if (state.activePoll) {
        upsertPollSummary(state.activePoll, state.activeResults);
        renderDashboard();
        renderDetail();
      }
    });

    state.ws.addEventListener("close", scheduleReconnect);
    state.ws.addEventListener("error", scheduleReconnect);
  }

  function subscribeToPoll(pollId) {
    if (!state.ws || state.ws.readyState !== 1) return;
    state.ws.send(JSON.stringify({ type: "subscribe", pollId: pollId }));
  }

  function scheduleReconnect() {
    if (state.ws) {
      try {
        state.ws.close();
      } catch (err) {
        // ignore
      }
    }
    state.wsRetries += 1;
    var delay = Math.min(10000, 500 * state.wsRetries);
    setTimeout(connectWebSocket, delay);
  }

  function deriveWSUrl() {
    if (!window.location || !window.location.host) return "";
    var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + window.location.host + "/ws";
  }
})();
