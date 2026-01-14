// Test script to check if directories are selected and list images
import { invoke } from '@tauri-apps/api/core';

async function testImageLoading() {
  try {
    // Check current localStorage
    const selectedDirs = localStorage.getItem('ocd-selected-directories');
    console.log('Selected directories:', selectedDirs);

    if (selectedDirs) {
      const dirs = JSON.parse(selectedDirs);
      console.log('Parsed directories:', dirs);

      // Test listing files in one directory
      if (dirs.length > 0) {
        const images = await invoke('list_files', { path: dirs[0], fileType: 'images' });
        console.log('Images found in first directory:', images);
      }
    } else {
      console.log('No directories selected yet');
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testImageLoading();