// Global variables
let currentSessionId = null;
let selectedFormat = null;
let currentJobId = null;
let statusCheckInterval = null;

// DOM elements
const videoUrlInput = document.getElementById("videoUrl");
const extractBtn = document.getElementById("extractBtn");
const loadingSection = document.getElementById("loadingSection");
const videoInfoSection = document.getElementById("videoInfoSection");
const downloadSection = document.getElementById("downloadSection");
const downloadCompleteSection = document.getElementById(
  "downloadCompleteSection"
);
const errorSection = document.getElementById("errorSection");
const downloadBtn = document.getElementById("downloadBtn");
const formatList = document.getElementById("formatList");
const downloadLink = document.getElementById("downloadLink");
const downloadAnotherBtn = document.getElementById("downloadAnotherBtn");
const retryBtn = document.getElementById("retryBtn");
const errorMessage = document.getElementById("errorMessage");

// Job status elements
const jobStatus = document.getElementById("jobStatus");
const jobIdElement = document.getElementById("jobId");
const videoTitle2 = document.getElementById("videoTitle2");

// ✅ URL Processing Functions
function normalizeInstagramURL(url) {
  try {
    url = url.trim().replace(/\/$/, "");

    const patterns = [
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/stories\/([A-Za-z0-9_.]+)\/([0-9]+)/i,
    ];

    for (let pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        if (pattern.source.includes("stories")) {
          return {
            url: `https://www.instagram.com/stories/${match[1]}/${match[2]}/`,
            type: "story",
            id: match[2],
            username: match[1],
          };
        } else {
          const postId = match[1];
          return {
            url: `https://www.instagram.com/reel/${postId}/?utm_source=ig_web_copy_link`,
            type: "reel",
            id: postId,
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error("URL normalization error:", error);
    return null;
  }
}

function detectInstagramContentType(url) {
  if (url.includes("/stories/")) {
    return "story";
  } else if (url.includes("/reels/") || url.includes("/reel/")) {
    return "reel";
  } else if (url.includes("/p/")) {
    return "post";
  } else if (url.includes("/tv/")) {
    return "igtv";
  }
  return "unknown";
}

function validateInstagramURL(url) {
  const normalizedData = normalizeInstagramURL(url);
  if (!normalizedData) {
    return {
      valid: false,
      error: "Invalid Instagram URL format",
    };
  }

  return {
    valid: true,
    data: normalizedData,
  };
}

// Event listeners
extractBtn.addEventListener("click", extractVideoInfo);
downloadBtn.addEventListener("click", downloadVideo);
downloadAnotherBtn.addEventListener("click", resetForm);
retryBtn.addEventListener("click", resetForm);
videoUrlInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") extractVideoInfo();
});

// Show section function
function showSection(section) {
  const sections = [
    loadingSection,
    videoInfoSection,
    downloadSection,
    downloadCompleteSection,
    errorSection,
  ];
  sections.forEach((s) => s.classList.add("hidden"));
  section.classList.remove("hidden");
}

// ✅ ENHANCED ERROR DISPLAY
function showError(message, isStoryError = false, errorData = null) {
  if (isStoryError && errorData) {
    errorMessage.innerHTML = `
                <div style="text-align: center;">
                    <h3 style="color: #e74c3c; margin-bottom: 15px;">
                        <i class="fas fa-exclamation-triangle"></i> 
                        Instagram Stories Not Supported
                    </h3>
                    <p style="margin-bottom: 15px; font-size: 16px; color: #666;">
                        ${
                          errorData.message ||
                          "Instagram Stories cannot be downloaded due to platform restrictions."
                        }
                    </p>
                    
                    ${
                      errorData.details && errorData.details.reasons
                        ? `
                    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ffc107;">
                        <h4 style="color: #856404; margin-bottom: 10px;">
                            <i class="fas fa-info-circle"></i> Why Stories Don't Work:
                        </h4>
                        <ul style="text-align: left; margin: 0; padding-left: 20px; color: #856404;">
                            ${errorData.details.reasons
                              .map((reason) => `<li>${reason}</li>`)
                              .join("")}
                        </ul>
                    </div>
                    `
                        : ""
                    }
                    
                    ${
                      errorData.details && errorData.details.alternatives
                        ? `
                    <div style="background: #d1edff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #007bff;">
                        <h4 style="color: #004085; margin-bottom: 10px;">
                            <i class="fas fa-lightbulb"></i> Try These Instead:
                        </h4>
                        <ul style="text-align: left; margin: 0; padding-left: 20px; color: #004085;">
                            ${errorData.details.alternatives
                              .map((alt) => `<li><strong>${alt}</strong></li>`)
                              .join("")}
                        </ul>
                    </div>
                    `
                        : ""
                    }
                    
                    <div style="background: #d4edda; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
                        <p style="margin: 0; color: #155724; font-weight: bold;">
                            <i class="fas fa-arrow-up"></i> 
                            ${
                              errorData.recommendation ||
                              "Paste a Reel or Post URL above for better results!"
                            }
                        </p>
                    </div>
                </div>
            `;
  } else {
    errorMessage.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <i class="fas fa-exclamation-circle" style="font-size: 48px; color: #e74c3c; margin-bottom: 15px;"></i>
                    <h3 style="color: #e74c3c; margin-bottom: 15px;">Error</h3>
                    <p style="color: #666; font-size: 16px;">${message}</p>
                </div>
            `;
  }
  showSection(errorSection);
  clearStatusCheck();
}

// Clear status check interval
function clearStatusCheck() {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
    statusCheckInterval = null;
  }
}

// Format functions
function formatFileSize(bytes) {
  if (bytes === 0 || !bytes) return "Unknown size";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDuration(seconds) {
  if (!seconds) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatNumber(num) {
  if (!num) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

// Update job status badge
function updateJobStatus(status) {
  const statusConfig = {
    queued: { icon: "fa-clock", text: "Queued", class: "queued" },
    downloading: {
      icon: "fa-download",
      text: "Downloading",
      class: "downloading",
    },
    completed: {
      icon: "fa-check",
      text: "Completed",
      class: "completed",
    },
    failed: { icon: "fa-times", text: "Failed", class: "failed" },
  };
  const config = statusConfig[status] || statusConfig.queued;
  if (jobStatus) {
    jobStatus.className = `job-status ${config.class}`;
    jobStatus.innerHTML = `<i class="fas ${config.icon}"></i><span>${config.text}</span>`;
  }
}

// ✅ MAIN EXTRACT FUNCTION - COMPLETELY FIXED
async function extractVideoInfo() {
  const url = videoUrlInput.value.trim();
  if (!url) {
    showError("Please enter an Instagram video URL");
    return;
  }

  const validation = validateInstagramURL(url);
  if (!validation.valid) {
    showError(validation.error);
    return;
  }

  const normalizedData = validation.data;

  const contentTypeMessages = {
    story: "Checking Instagram Story...",
    reel: "Extracting Instagram Reel...",
    post: "Extracting Instagram Post...",
    igtv: "Extracting IGTV Video...",
  };

  showSection(loadingSection);
  animateExtractProgress(
    contentTypeMessages[normalizedData.type] ||
      "Extracting Instagram Content..."
  );
  extractBtn.disabled = true;

  try {
    const response = await fetch("/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: normalizedData.url,
        content_type: normalizedData.type,
        original_url: url,
      }),
    });

    // ✅ ALWAYS EXPECT 200 OK - Check success in JSON
    const data = await response.json();

    if (data.success) {
      currentSessionId = data.session_id;
      displayVideoInfo(data.video_info, normalizedData.type);
    } else {
      // Handle different error types
      if (data.error_type === "story_not_supported") {
        showError(data.error, true, data);
      } else {
        showError(data.error || "Failed to extract video information");
      }
    }
  } catch (error) {
    console.error("Network error:", error);
    showError("Network error. Please check your connection and try again.");
  } finally {
    extractBtn.disabled = false;
  }
}

// Display video info
function displayVideoInfo(videoInfo, contentType = "reel") {
  const thumbnailContainer = document.getElementById("videoThumbnailContainer");
  if (thumbnailContainer) {
    thumbnailContainer.innerHTML = `
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200' viewBox='0 0 300 200'%3E%3Crect width='300' height='200' fill='%23f0f0f0'/%3E%3Ctext x='50%25' y='50%25' font-size='14' text-anchor='middle' dy='.3em' fill='%23999'%3EInstagram Content%3C/text%3E%3C/svg%3E"
                     alt="Video Thumbnail" style="width: 100%; height: 200px; object-fit: cover;" />
                <div class="play-overlay">
                    <i class="fab fa-instagram"></i>
                </div>
            `;
  }

  const contentTitles = {
    story: "Instagram Story",
    reel: "Instagram Reel",
    post: "Instagram Post",
    igtv: "IGTV Video",
  };

  const titleElement = document.getElementById("videoTitle");
  const uploaderElement = document.getElementById("videoUploader");
  const durationElement = document.getElementById("videoDuration");
  const viewsElement = document.getElementById("videoViews");

  if (titleElement)
    titleElement.textContent =
      videoInfo.title || contentTitles[contentType] || "Instagram Content";
  if (uploaderElement)
    uploaderElement.innerHTML = `<i class="fas fa-user"></i> ${
      videoInfo.uploader || "Unknown"
    }`;
  if (durationElement)
    durationElement.innerHTML = `<i class="fas fa-clock"></i> ${formatDuration(
      videoInfo.duration
    )}`;
  if (viewsElement)
    viewsElement.innerHTML = `<i class="fas fa-eye"></i> ${formatNumber(
      videoInfo.view_count || 0
    )} views`;

  // Populate format list
  if (formatList) {
    formatList.innerHTML = "";
    if (!videoInfo.formats || videoInfo.formats.length === 0) {
      formatList.innerHTML =
        '<p style="color: #666; text-align: center; padding: 20px;">No formats available.</p>';
      return;
    }

    videoInfo.formats.forEach((format) => {
      const formatItem = document.createElement("div");
      formatItem.className = "format-item";

      let qualityDisplay = format.quality || "Unknown Quality";
      if (format.height && format.width) {
        qualityDisplay = `${format.height}p (${format.width}x${format.height})`;
      }

      let resolutionInfo = "";
      if (format.height && format.width) {
        resolutionInfo = `<span class="format-resolution">${format.width}x${format.height}</span>`;
      }

      const iconClass = format.type === "audio" ? "fa-music" : "fa-video";

      formatItem.innerHTML = `
                    <div class="format-info">
                        <span class="format-quality">${qualityDisplay}</span>
                        <span class="format-type">${
                          format.ext ? format.ext.toUpperCase() : "MP4"
                        }</span>
                        ${
                          format.filesize
                            ? `<span class="format-size">${formatFileSize(
                                format.filesize
                              )}</span>`
                            : ""
                        }
                        ${resolutionInfo}
                    </div>
                    <div class="format-icon">
                        <i class="fas ${iconClass}"></i>
                    </div>
                `;

      formatItem.addEventListener("click", () =>
        selectFormat(format, formatItem)
      );
      formatList.appendChild(formatItem);
    });
  }

  showSection(videoInfoSection);
}

// Select format
function selectFormat(format, element) {
  document.querySelectorAll(".format-item").forEach((item) => {
    item.classList.remove("selected");
  });
  element.classList.add("selected");
  selectedFormat = format;

  if (downloadBtn) {
    downloadBtn.classList.remove("disabled");
    const qualityText = format.height ? `${format.height}p` : format.quality;
    const extText = format.ext ? format.ext.toUpperCase() : "MP4";
    downloadBtn.innerHTML = `
                <i class="fas fa-download"></i>
                <span>Download ${qualityText} (${extText})</span>
            `;
  }
}

// Download video
async function downloadVideo() {
  if (!selectedFormat || !currentSessionId) {
    showError("Please select a format first");
    return;
  }

  showSection(downloadSection);
  updateJobStatus("queued");

  try {
    const response = await fetch("/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: currentSessionId,
        format_id: selectedFormat.format_id,
      }),
    });

    const data = await response.json();

    if (data.success) {
      currentJobId = data.job_id;
      if (jobIdElement) {
        jobIdElement.textContent = `Job ID: ${currentJobId.substring(0, 8)}...`;
      }
      startStatusCheck();
    } else {
      if (data.error_type === "story_download_blocked") {
        showError("Stories cannot be downloaded", true, {
          message: data.error,
          recommendation: "Please try using Instagram Reels or Posts instead!",
        });
      } else {
        showError(data.error || "Failed to start download");
      }
    }
  } catch (error) {
    console.error("Download error:", error);
    showError("Network error during download. Please try again.");
  }
}

// Start status checking
function startStatusCheck() {
  if (!currentJobId) return;

  statusCheckInterval = setInterval(async () => {
    try {
      const response = await fetch(`/status/${currentJobId}`);
      const data = await response.json();

      if (data.success) {
        updateDownloadProgress(data);

        if (data.status === "completed") {
          clearStatusCheck();
          showDownloadComplete(data);
        } else if (data.status === "failed") {
          clearStatusCheck();
          showError(data.error || "Download failed");
        }
      } else {
        clearStatusCheck();
        showError("Failed to check download status");
      }
    } catch (error) {
      console.error("Status check error:", error);
      clearStatusCheck();
      showError("Network error while checking status");
    }
  }, 1000);
}

// Update download progress
function updateDownloadProgress(jobData) {
  const { status, progress = 0, video_title } = jobData;

  updateJobStatus(status);

  const progressPercent = Math.floor(progress);

  // Update circular progress
  const progressCircle = document.getElementById("downloadProgressCircle");
  const circularProgress = document.getElementById("downloadCircularProgress");
  if (progressCircle && circularProgress) {
    const circumference = 2 * Math.PI * 50;
    const offset = circumference - (progress / 100) * circumference;
    progressCircle.style.strokeDashoffset = offset;
    circularProgress.textContent = progressPercent + "%";
  }

  // Update progress bar
  const progressFill = document.getElementById("downloadProgressFill");
  const progressPercentage = document.getElementById(
    "downloadProgressPercentage"
  );
  if (progressFill) progressFill.style.width = progress + "%";
  if (progressPercentage)
    progressPercentage.textContent = progressPercent + "%";

  // Update text
  const statusTexts = {
    queued: "Queued for download",
    downloading: "Downloading Instagram content",
    completed: "Download complete",
  };

  const statusDetails = {
    queued: "Your download is in the queue...",
    downloading: "Your Instagram content is being downloaded...",
    completed: "Your content has been downloaded successfully!",
  };

  const downloadText = document.getElementById("downloadText");
  const downloadDetails = document.getElementById("downloadDetails");
  const progressLabel = document.getElementById("downloadProgressLabel");

  if (downloadText)
    downloadText.textContent = statusTexts[status] || "Processing";
  if (downloadDetails)
    downloadDetails.textContent =
      statusDetails[status] || "Processing your request...";
  if (progressLabel)
    progressLabel.textContent =
      status.charAt(0).toUpperCase() + status.slice(1) + "...";

  if (video_title && videoTitle2) {
    videoTitle2.textContent = `Content: ${video_title.substring(0, 30)}...`;
  }
}

// Show download complete
function showDownloadComplete(jobData) {
  if (jobData.download_url && downloadLink) {
    downloadLink.href = jobData.download_url;
    downloadLink.download = jobData.filename || "instagram_content";
  }
  showSection(downloadCompleteSection);
}

// Reset form
function resetForm() {
  videoUrlInput.value = "";
  currentSessionId = null;
  selectedFormat = null;
  currentJobId = null;
  clearStatusCheck();

  if (downloadBtn) {
    downloadBtn.classList.add("disabled");
    downloadBtn.innerHTML = `
                <i class="fas fa-download"></i>
                <span>Select a format to download</span>
            `;
  }

  const sections = [
    loadingSection,
    videoInfoSection,
    downloadSection,
    downloadCompleteSection,
    errorSection,
  ];
  sections.forEach((s) => s.classList.add("hidden"));
}

// Auto-focus
if (videoUrlInput) videoUrlInput.focus();

// Progress animation
function animateExtractProgress(
  customMessage = "Extracting Instagram content..."
) {
  const circularProgress = document.getElementById("circularProgress");
  const progressCircle = document.getElementById("progressCircle");
  const progressFill = document.getElementById("progressFill");
  const progressPercentage = document.getElementById("progressPercentage");
  const progressLabel = document.getElementById("progressLabel");
  const loadingDetails = document.getElementById("loadingDetails");

  if (!progressCircle || !circularProgress) return;

  let progress = 0;
  const duration = 2000;
  const startTime = Date.now();

  const stages = [
    {
      progress: 20,
      label: "Connecting to Instagram...",
      details: "Establishing secure connection",
    },
    {
      progress: 50,
      label: customMessage,
      details: "Retrieving content information",
    },
    {
      progress: 80,
      label: "Processing formats...",
      details: "Analyzing available qualities",
    },
    {
      progress: 100,
      label: "Complete!",
      details: "Content information extracted successfully",
    },
  ];

  let currentStage = 0;

  const interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    progress = Math.min((elapsed / duration) * 100, 100);

    while (
      currentStage < stages.length - 1 &&
      progress >= stages[currentStage + 1].progress
    ) {
      currentStage++;
      if (progressLabel) progressLabel.textContent = stages[currentStage].label;
      if (loadingDetails)
        loadingDetails.textContent = stages[currentStage].details;
    }

    const circumference = 2 * Math.PI * 50;
    const offset = circumference - (progress / 100) * circumference;
    progressCircle.style.strokeDashoffset = offset;
    circularProgress.textContent = Math.floor(progress) + "%";

    if (progressFill) progressFill.style.width = progress + "%";
    if (progressPercentage)
      progressPercentage.textContent = Math.floor(progress) + "%";

    if (progress >= 100) {
      clearInterval(interval);
    }
  }, 50);
}
