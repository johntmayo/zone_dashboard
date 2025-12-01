const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files from current directory

// Google Sheets API setup
// Using public sheet access (no auth needed if sheet is set to "Anyone with link can view")
// Set CENTRAL_SHEET_ID environment variable or update the default below
// To get the sheet ID from a Google Sheets URL: https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
const CENTRAL_SHEET_ID = process.env.CENTRAL_SHEET_ID || '1PaqcX2BSypJjLBDMA3DnlAxCHK5y0TWMSbCIkTScIQU';

// Helper function to fetch Google Sheet data (public access)
async function fetchPublicSheet(sheetId, range = 'A1:ZZ1000') {
  try {
    // For public sheets, we can use CSV export
    // Try multiple URL formats
    const urls = [
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Sheet1`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
    ];
    
    const https = require('https');
    const http = require('http');
    
    // Try each URL until one works
    for (const url of urls) {
      try {
        const result = await new Promise((resolve, reject) => {
          const protocol = url.startsWith('https') ? https : http;
          
          const request = protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
              const redirectUrl = response.headers.location;
              if (redirectUrl) {
                console.log('Following redirect to:', redirectUrl);
                // Create new request for redirect
                const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
                const redirectRequest = redirectProtocol.get(redirectUrl, (redirectResponse) => {
                  handleResponse(redirectResponse, resolve, reject);
                });
                redirectRequest.on('error', reject);
                redirectRequest.setTimeout(10000, () => {
                  redirectRequest.destroy();
                  reject(new Error('Request timeout'));
                });
                return;
              }
            }
            
            handleResponse(response, resolve, reject);
          });
          
          request.on('error', (error) => {
            console.error('Request error for URL:', url, error);
            reject(error);
          });
          
          request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
          });
        });
        
        // If we got here, the request succeeded
        return result;
      } catch (error) {
        console.log(`Failed to fetch with URL: ${url}`, error.message);
        // Continue to next URL
        continue;
      }
    }
    
    // If all URLs failed, throw error
    throw new Error('All export URL formats failed. Please ensure the sheet is set to "Anyone with the link can view" and try publishing it to web (File > Share > Publish to web).');
    
    function handleResponse(response, resolve, reject) {
      if (response.statusCode !== 200) {
        console.error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      let csvText = '';
      response.on('data', (chunk) => {
        csvText += chunk.toString();
      });
      
      response.on('end', () => {
        try {
          // Check if we got HTML instead of CSV (common when sheet isn't public)
          if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
            console.error('Received HTML instead of CSV. Sheet may not be publicly accessible.');
            reject(new Error('Sheet is not publicly accessible. Please ensure it is set to "Anyone with the link can view" and try publishing it to web (File > Share > Publish to web).'));
            return;
          }
          
          // Parse CSV
          const lines = csvText.split('\n').filter(line => line.trim());
          if (lines.length === 0) {
            resolve({ headers: [], rows: [] });
            return;
          }
          
          // Parse header
          const headers = parseCSVLine(lines[0]);
          console.log('Parsed headers:', headers);
          
          // Parse rows
          const rows = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const row = {};
            headers.forEach((header, index) => {
              row[header] = values[index] || '';
            });
            return row;
          });
          
          console.log(`Parsed ${rows.length} rows`);
          resolve({ headers, rows });
        } catch (error) {
          console.error('Error parsing CSV:', error);
          reject(error);
        }
      });
    }
  } catch (error) {
    console.error('Error fetching sheet:', error);
    throw error;
  }
}

// Simple CSV parser (handles quoted fields)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  result.push(current.trim());
  
  return result;
}

// API Route: Homepage Feed
app.get('/api/homepage-feed', async (req, res) => {
  try {
    console.log('Fetching homepage feed from central sheet...');
    
    // Fetch the central sheet data
    const { headers, rows } = await fetchPublicSheet(CENTRAL_SHEET_ID);
    
    // The sheet structure: Column A is "Label", Columns B, C, D, etc. are "Content"
    // Each row represents one item with a label and multiple content fields
    
    const result = {
      items: []
    };
    
    // Column A is the label column
    const labelCol = headers[0] || 'Label';
    
    // Process each row
    rows.forEach((row) => {
      const label = (row[labelCol] || '').trim();
      
      // Skip rows without a label
      if (!label) return;
      
      // Get all content columns (B, C, D, etc.) - everything after the label column
      const content = [];
      for (let i = 1; i < headers.length; i++) {
        const contentValue = (row[headers[i]] || '').trim();
        if (contentValue) {
          content.push(contentValue);
        }
      }
      
      // Only add items that have at least a label
      if (label) {
        result.items.push({
          label: label,
          content: content
        });
      }
    });
    
    console.log('Homepage feed fetched successfully');
    res.json(result);
  } catch (error) {
    console.error('Error fetching homepage feed:', error);
    res.status(500).json({ 
      error: 'Failed to fetch homepage feed',
      message: error.message 
    });
  }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Central sheet ID: ${CENTRAL_SHEET_ID}`);
  console.log(`To change the sheet, update CENTRAL_SHEET_ID in server.js or set CENTRAL_SHEET_ID environment variable`);
});

