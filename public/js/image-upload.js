/**
 * Image Upload - Drag & Drop + Clipboard Paste
 * Phase 4.4 Enhancement for Bulletin Board
 */

(function() {
  'use strict';

  let uploadedFile = null;

  // Initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form[action="/board"]');
    if (!form) return;

    const textarea = form.querySelector('#board-content');
    const imageUrlInput = form.querySelector('#image_url');

    // Create upload UI
    createUploadUI(form, imageUrlInput);

    // Drag & Drop on textarea
    setupDragDrop(textarea);

    // Clipboard paste
    setupClipboardPaste(textarea);

    // Clear preview on form submit
    form.addEventListener('submit', function() {
      uploadedFile = null;
    });
  });

  // Create upload UI elements
  function createUploadUI(form, imageUrlInput) {
    const uploadWrapper = document.createElement('div');
    uploadWrapper.className = 'image-upload-wrapper';
    uploadWrapper.innerHTML = `
      <div class="image-upload-zone" id="image-upload-zone">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        <p><strong>Drop image here</strong> or <label for="image-file-input" class="image-upload-link">browse</label></p>
        <p class="image-upload-hint">Also supports: Paste from clipboard, or enter URL below</p>
      </div>
      <input type="file" id="image-file-input" name="image_file" accept="image/*" style="display: none;">
      <div class="image-preview-container" id="image-preview-container" style="display: none;">
        <img id="image-preview" src="" alt="Preview">
        <button type="button" class="image-preview-remove" id="image-preview-remove" title="Remove image">&times;</button>
      </div>
    `;

    // Insert after image_url input
    imageUrlInput.parentElement.after(uploadWrapper);

    // File input change
    const fileInput = document.getElementById('image-file-input');
    fileInput.addEventListener('change', function(e) {
      if (this.files.length > 0) {
        handleFile(this.files[0]);
      }
    });

    // Remove preview button
    document.getElementById('image-preview-remove').addEventListener('click', removePreview);
  }

  // Setup drag & drop on textarea
  function setupDragDrop(textarea) {
    const zone = document.getElementById('image-upload-zone');
    if (!zone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      zone.addEventListener(eventName, preventDefaults, false);
      textarea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Highlight drop zone
    ['dragenter', 'dragover'].forEach(eventName => {
      zone.addEventListener(eventName, () => zone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      zone.addEventListener(eventName, () => zone.classList.remove('drag-over'), false);
    });

    // Handle dropped files
    zone.addEventListener('drop', function(e) {
      const dt = e.dataTransfer;
      const files = dt.files;

      if (files.length > 0) {
        handleFile(files[0]);
      }
    }, false);
  }

  // Setup clipboard paste
  function setupClipboardPaste(textarea) {
    textarea.addEventListener('paste', function(e) {
      const items = e.clipboardData.items;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const blob = items[i].getAsFile();
          handleFile(blob);
          break;
        }
      }
    });
  }

  // Handle file (drag/drop/paste/browse)
  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      if (window.Toast) {
        window.Toast.error('Please select an image file');
      }
      return;
    }

    // Max 30MB
    if (file.size > 30 * 1024 * 1024) {
      if (window.Toast) {
        window.Toast.error('Image too large (max 30MB)');
      }
      return;
    }

    // Store file
    uploadedFile = file;

    // Update hidden file input
    const fileInput = document.getElementById('image-file-input');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    // Show preview
    showPreview(file);

    // Clear URL input (prioritize file upload)
    const imageUrlInput = document.getElementById('image_url');
    if (imageUrlInput) {
      imageUrlInput.value = '';
      imageUrlInput.disabled = true;
    }
  }

  // Show image preview
  function showPreview(file) {
    const reader = new FileReader();

    reader.onload = function(e) {
      const preview = document.getElementById('image-preview');
      const container = document.getElementById('image-preview-container');
      const zone = document.getElementById('image-upload-zone');

      preview.src = e.target.result;
      container.style.display = 'block';
      if (zone) zone.style.display = 'none';
    };

    reader.readAsDataURL(file);
  }

  // Remove preview
  function removePreview() {
    uploadedFile = null;

    const preview = document.getElementById('image-preview');
    const container = document.getElementById('image-preview-container');
    const zone = document.getElementById('image-upload-zone');
    const fileInput = document.getElementById('image-file-input');
    const imageUrlInput = document.getElementById('image_url');

    preview.src = '';
    container.style.display = 'none';
    if (zone) zone.style.display = 'flex';

    // Clear file input
    if (fileInput) fileInput.value = '';

    // Re-enable URL input
    if (imageUrlInput) imageUrlInput.disabled = false;
  }

})();
