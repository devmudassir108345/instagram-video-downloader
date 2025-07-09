
import os
import yt_dlp
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import re
import uuid
from urllib.parse import urlparse
import json
import time
import glob
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, Optional
import threading
from datetime import datetime

# Pydantic models
class URLRequest(BaseModel):
    url: str
    content_type: Optional[str] = None
    original_url: Optional[str] = None

class DownloadRequest(BaseModel):
    session_id: str
    format_id: str = None

app = FastAPI(title="Instagram Downloader API - Complete Fix")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup templates and static files
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

def sanitize_title(title):
    return re.sub(r'[\\/*?:"<>|]', "_", title)

# Create directories
os.makedirs('uploads', exist_ok=True)
os.makedirs('outputs', exist_ok=True)
os.makedirs('static', exist_ok=True)
os.makedirs('templates', exist_ok=True)

# Global variables
video_cache = {}
download_jobs: Dict[str, Dict[str, Any]] = {}
job_lock = threading.Lock()
executor = ThreadPoolExecutor(max_workers=15)

class InstagramDownloader:
    def __init__(self):
        self.extract_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extract_flat': False,
            'writesubtitles': False,
            'writeautomaticsub': False,
            'socket_timeout': 30,
            'retries': 2,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        
        self.download_opts = {
            'quiet': True,
            'no_warnings': True,
            'extractaudio': False,
            'writesubtitles': False,
            'writeautomaticsub': False,
            'socket_timeout': 60,
            'retries': 3,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }

    def is_valid_instagram_url(self, url):
        """Check if URL is valid Instagram URL"""
        patterns = [
            r'https?://(?:www\.)?instagram\.com/p/[A-Za-z0-9_-]+',
            r'https?://(?:www\.)?instagram\.com/reel/[A-Za-z0-9_-]+',
            r'https?://(?:www\.)?instagram\.com/reels/[A-Za-z0-9_-]+',
            r'https?://(?:www\.)?instagram\.com/tv/[A-Za-z0-9_-]+',
            r'https?://(?:www\.)?instagram\.com/stories/[A-Za-z0-9_.-]+/[0-9]+',
        ]
        
        for pattern in patterns:
            if re.match(pattern, url):
                return True
        return False

    def detect_content_type(self, url):
        """Detect content type from URL"""
        if '/stories/' in url:
            return 'story'
        elif '/reels/' in url or '/reel/' in url:
            return 'reel'
        elif '/p/' in url:
            return 'post'
        elif '/tv/' in url:
            return 'igtv'
        return 'unknown'

    def extract_info(self, url, content_type=None):
        """Extract video information"""
        try:
            # ✅ Handle stories immediately
            if content_type == 'story':
                return {
                    'success': False,
                    'error': 'Instagram Stories are not supported',
                    'error_type': 'story_not_supported',
                    'message': 'Stories cannot be downloaded due to Instagram restrictions'
                }
            
            # Extract info for other content
            with yt_dlp.YoutubeDL(self.extract_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
                return {
                    'success': True,
                    'data': info,
                    'content_type': content_type
                }
                
        except yt_dlp.DownloadError as e:
            error_msg = str(e)
            
            if "You need to log in" in error_msg or "cookies" in error_msg.lower():
                return {
                    'success': False,
                    'error': 'This content requires authentication',
                    'error_type': 'authentication_required'
                }
            elif "only available for registered users" in error_msg:
                return {
                    'success': False,
                    'error': 'This content is private',
                    'error_type': 'private_content'
                }
            elif "Video unavailable" in error_msg:
                return {
                    'success': False,
                    'error': 'Video is unavailable',
                    'error_type': 'video_unavailable'
                }
            else:
                return {
                    'success': False,
                    'error': f'Extraction error: {error_msg}',
                    'error_type': 'extraction_error'
                }
        except Exception as e:
            return {
                'success': False,
                'error': f'Unexpected error: {str(e)}',
                'error_type': 'unexpected_error'
            }

    def get_unique_filename(self, base_path, title, ext):
        """Generate unique filename"""
        safe_title = sanitize_title(title)
        base_filename = f"{safe_title}.{ext}"
        full_path = os.path.join(base_path, base_filename)
        
        if not os.path.exists(full_path):
            return base_filename
        
        counter = 1
        while True:
            new_filename = f"{safe_title}_{counter}.{ext}"
            new_full_path = os.path.join(base_path, new_filename)
            if not os.path.exists(new_full_path):
                return new_filename
            counter += 1

    def download_video(self, url, format_id, job_id, content_type=None):
        """Download video"""
        try:
            if content_type == 'story':
                with job_lock:
                    if job_id in download_jobs:
                        download_jobs[job_id].update({
                            'status': 'failed',
                            'error': 'Stories cannot be downloaded'
                        })
                return
            
            with job_lock:
                if job_id in download_jobs:
                    download_jobs[job_id]['status'] = 'downloading'
                    download_jobs[job_id]['progress'] = 5

            unique_id = str(uuid.uuid4())[:8]
            download_opts = self.download_opts.copy()
            
            if format_id == 'audio_only':
                download_opts.update({
                    'format': 'bestaudio/best',
                    'outtmpl': f'outputs/{unique_id}_%(title)s.%(ext)s',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    }],
                    'prefer_ffmpeg': True,
                })
            elif format_id and format_id != 'best':
                download_opts.update({
                    'format': format_id,
                    'outtmpl': f'outputs/{unique_id}_%(title)s.%(ext)s'
                })
            else:
                download_opts.update({
                    'format': 'best[height>=720][acodec!=none]/best[height>=480][acodec!=none]/best[acodec!=none]/best',
                    'outtmpl': f'outputs/{unique_id}_%(title)s.%(ext)s'
                })
            
            def progress_hook(d):
                try:
                    if d['status'] == 'downloading':
                        progress = 50
                        if '_percent_str' in d:
                            percent_str = d['_percent_str'].replace('%', '').strip()
                            try:
                                progress = float(percent_str)
                            except:
                                progress = 50
                        
                        with job_lock:
                            if job_id in download_jobs:
                                download_jobs[job_id]['progress'] = min(progress, 95)
                    
                    elif d['status'] == 'finished':
                        with job_lock:
                            if job_id in download_jobs:
                                download_jobs[job_id]['progress'] = 95
                                download_jobs[job_id]['status'] = 'processing'
                except Exception:
                    pass
            
            download_opts['progress_hooks'] = [progress_hook]
            
            with yt_dlp.YoutubeDL(download_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                
                temp_filename = ydl.prepare_filename(info)
                
                if format_id == 'audio_only':
                    base_name = os.path.splitext(temp_filename)[0]
                    temp_filename = base_name + '.mp3'
                
                title = info.get('title', 'Instagram Content')
                ext = 'mp3' if format_id == 'audio_only' else info.get('ext', 'mp4')
                
                final_filename = self.get_unique_filename('outputs', title, ext)
                new_path = os.path.join('outputs', final_filename)
                
                # Wait and rename file
                for attempt in range(60):
                    if os.path.exists(temp_filename):
                        try:
                            if os.path.exists(new_path):
                                os.remove(new_path)
                            os.rename(temp_filename, new_path)
                            break
                        except OSError:
                            if attempt == 59:
                                with job_lock:
                                    if job_id in download_jobs:
                                        download_jobs[job_id].update({
                                            'status': 'failed',
                                            'error': 'File processing error'
                                        })
                                return
                    time.sleep(0.5)
                
                if os.path.exists(new_path):
                    file_size = os.path.getsize(new_path)
                    
                    with job_lock:
                        if job_id in download_jobs:
                            download_jobs[job_id].update({
                                'status': 'completed',
                                'progress': 100,
                                'file_path': new_path,
                                'filename': final_filename,
                                'file_size': file_size,
                                'download_url': f"/video/{final_filename}",
                                'info': {
                                    'title': title,
                                    'duration': info.get('duration'),
                                    'uploader': info.get('uploader')
                                }
                            })
                else:
                    with job_lock:
                        if job_id in download_jobs:
                            download_jobs[job_id].update({
                                'status': 'failed',
                                'error': 'File not found after download'
                            })
        
        except Exception as e:
            with job_lock:
                if job_id in download_jobs:
                    download_jobs[job_id].update({
                        'status': 'failed',
                        'error': f'Download failed: {str(e)}'
                    })

# Async wrappers
async def extract_info_async(url, content_type=None):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, downloader.extract_info, url, content_type)

async def download_video_async(url, format_id, job_id, content_type=None):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, downloader.download_video, url, format_id, job_id, content_type)

downloader = InstagramDownloader()

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# ✅ MAIN EXTRACT ENDPOINT - COMPLETELY FIXED
@app.post("/extract")
async def extract_video_info(request_data: URLRequest):
    """Extract video information - Complete fix"""
    try:
        url = request_data.url.strip()
        content_type = request_data.content_type
        original_url = request_data.original_url or url
        
        if not url:
            return JSONResponse(
                status_code=200,
                content={
                    'success': False,
                    'error': 'Please provide a URL',
                    'error_type': 'missing_url'
                }
            )
        
        if not downloader.is_valid_instagram_url(url):
            return JSONResponse(
                status_code=200,
                content={
                    'success': False,
                    'error': 'Please provide a valid Instagram URL',
                    'error_type': 'invalid_url'
                }
            )
        
        if not content_type:
            content_type = downloader.detect_content_type(url)
        
        # ✅ STORIES HANDLING - Return success=false with details
        if content_type == 'story':
            return JSONResponse(
                status_code=200,
                content={
                    'success': False,
                    'error': 'Instagram Stories Not Supported',
                    'error_type': 'story_not_supported',
                    'message': 'Instagram Stories cannot be downloaded due to platform restrictions.',
                    'details': {
                        'reasons': [
                            'Stories require Instagram login and authentication',
                            'Stories expire after 24 hours',
                            'Most stories are private or restricted',
                            'Instagram has strict anti-scraping measures'
                        ],
                        'alternatives': [
                            'Try downloading Instagram Reels instead',
                            'Use Instagram Posts (they work reliably)',
                            'Check if the content is available as a Reel'
                        ]
                    },
                    'recommendation': 'Please try using Instagram Reels or Posts instead!'
                }
            )
        
        # Extract info for other content
        result = await extract_info_async(url, content_type)
        
        if not result['success']:
            return JSONResponse(
                status_code=200,
                content={
                    'success': False,
                    'error': result['error'],
                    'error_type': result.get('error_type', 'unknown'),
                    'suggestion': 'Try using a different public Instagram post or reel.'
                }
            )
        
        info = result['data']
        
        # Process formats
        formats = []
        
        if 'formats' in info and info['formats']:
            video_formats = []
            
            for fmt in info['formats']:
                if (fmt.get('vcodec') != 'none' and 
                    fmt.get('acodec') != 'none' and 
                    fmt.get('height') and fmt.get('width')):
                    video_formats.append(fmt)
            
            video_formats.sort(key=lambda x: x.get('height', 0) * x.get('width', 0), reverse=True)
            
            seen_qualities = set()
            for fmt in video_formats:
                height = fmt.get('height', 0)
                if height and height not in seen_qualities and len(formats) < 3:
                    seen_qualities.add(height)
                    
                    if height >= 1080:
                        quality_label = f"High Quality ({height}p)"
                    elif height >= 720:
                        quality_label = f"HD ({height}p)"
                    else:
                        quality_label = f"Standard ({height}p)"
                    
                    formats.append({
                        'format_id': fmt.get('format_id'),
                        'ext': fmt.get('ext', 'mp4'),
                        'quality': quality_label,
                        'filesize': fmt.get('filesize'),
                        'width': fmt.get('width'),
                        'height': fmt.get('height'),
                        'type': 'video'
                    })
        
        if not formats:
            formats.append({
                'format_id': 'best',
                'ext': 'mp4',
                'quality': 'Best Available Quality',
                'type': 'video'
            })
        
        # Add audio option
        formats.append({
            'format_id': 'audio_only',
            'ext': 'mp3',
            'quality': 'Audio Only (MP3)',
            'type': 'audio'
        })
        
        # Create session
        session_id = str(uuid.uuid4())
        video_cache[session_id] = {
            'url': url,
            'content_type': content_type,
            'info': {
                'title': info.get('title', 'Instagram Content'),
                'duration': info.get('duration'),
                'thumbnail': info.get('thumbnail'),
                'uploader': info.get('uploader'),
                'view_count': info.get('view_count'),
                'formats': formats,
                'content_type': content_type
            }
        }
        
        return JSONResponse(
            status_code=200,
            content={
                'success': True,
                'session_id': session_id,
                'video_info': video_cache[session_id]['info'],
                'content_type': content_type
            }
        )
        
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={
                'success': False,
                'error': f'Server error: {str(e)}',
                'error_type': 'server_error'
            }
        )

@app.post("/download")
async def download_video_endpoint(request_data: DownloadRequest, background_tasks: BackgroundTasks):
    """Start download process"""
    try:
        session_id = request_data.session_id
        format_id = request_data.format_id
        
        if not session_id or session_id not in video_cache:
            return JSONResponse(
                status_code=200,
                content={
                    'success': False,
                    'error': 'Invalid session',
                    'error_type': 'invalid_session'
                }
            )
        
        cached_data = video_cache[session_id]
        content_type = cached_data.get('content_type', 'unknown')
        
        if content_type == 'story':
            return JSONResponse(
                status_code=200,
                content={
                    'success': False,
                    'error': 'Story downloads are not supported',
                    'error_type': 'story_download_blocked'
                }
            )
        
        job_id = str(uuid.uuid4())
        
        with job_lock:
            download_jobs[job_id] = {
                'status': 'queued',
                'progress': 0,
                'video_title': cached_data['info'].get('title', 'Instagram Content'),
                'format_id': format_id,
                'content_type': content_type,
                'created_at': datetime.now().isoformat()
            }
        
        background_tasks.add_task(
            download_video_async, 
            cached_data['url'], 
            format_id, 
            job_id, 
            content_type
        )
        
        return JSONResponse(
            status_code=200,
            content={
                'success': True,
                'job_id': job_id,
                'message': f'Download started for Instagram {content_type}'
            }
        )
        
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={
                'success': False,
                'error': f'Download start failed: {str(e)}',
                'error_type': 'download_start_error'
            }
        )

@app.get("/status/{job_id}")
async def get_download_status(job_id: str):
    """Check download status"""
    with job_lock:
        if job_id not in download_jobs:
            return JSONResponse(
                status_code=200,
                content={
                    'success': False,
                    'error': 'Job not found',
                    'error_type': 'job_not_found'
                }
            )
        
        job_data = download_jobs[job_id].copy()
    
    return JSONResponse(
        status_code=200,
        content={
            'success': True,
            'job_id': job_id,
            **job_data
        }
    )

@app.get("/video/{filename}")
async def serve_video(filename: str):
    """Serve video files"""
    try:
        file_path = os.path.join('outputs', filename)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        return FileResponse(
            file_path,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "*",
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving file: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check"""
    return JSONResponse(
        status_code=200,
        content={
            'status': 'OK',
            'message': 'Instagram Downloader API - Complete Fix',
            'supported_content': ['posts', 'reels', 'igtv'],
            'not_supported': ['stories'],
            'active_downloads': len(download_jobs)
        }
    )

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=5002, reload=True)
