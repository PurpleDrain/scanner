package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	_ "embed"

	"google.golang.org/genai"
)

//go:embed system_prompt.txt
var systemPrompt string

func main() {
	mux := http.NewServeMux()
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx := context.Background()

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		HTTPOptions: genai.HTTPOptions{APIVersion: "v1"},
	})
	if err != nil {
		log.Fatalf("failed to create genai client: %v", err)
	}

	mux.HandleFunc("GET /hello", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		successResponse(w, http.StatusOK, map[string]string{"message": "Hello, World!"})
	})

	mux.HandleFunc("POST /scan_document", func(w http.ResponseWriter, r *http.Request) {
		// Only read to disk
		r.ParseMultipartForm(0)
		file, fileHeader, err := r.FormFile("document_file")
		if err != nil {
			log.Printf("form file error: %v", err)
			errorResponse(w, http.StatusBadRequest, "Failed to read file")
			return
		}

		resp, err := scanDocument(client, ctx, file, fileHeader.Header.Get("Content-Type"))
		if err != nil {
			log.Printf("failed to scan document: %v", err)
			errorResponse(w, http.StatusInternalServerError, "Failed to scan document")
			return
		}

		var aiResponse any
		if err := json.Unmarshal([]byte(resp.Text()), &aiResponse); err != nil {
			log.Printf("failed to decode ai response: %v", err)
			errorResponse(w, http.StatusInternalServerError, "Failed to decode AI response")
			return
		}

		successResponse(
			w,
			http.StatusOK,
			map[string]interface{}{
				"filename":    fileHeader.Filename,
				"size":        fileHeader.Size,
				"mime":        fileHeader.Header.Get("Content-Type"),
				"ai_response": aiResponse,
			},
		)

		defer file.Close()
	})

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	go func() {
		log.Println("Listening on :" + port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func successResponse(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

func errorResponse(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func scanDocument(client *genai.Client, ctx context.Context, file multipart.File, mimeType string) (*genai.GenerateContentResponse, error) {
	content, err := buildContent(file, mimeType)
	if err != nil {
		return nil, err
	}

	resp, err := client.Models.GenerateContent(ctx,
		"gemini-3.5-flash",
		content,
		newGenerateContentConfig(),
	)
	if err != nil {
		return nil, err
	}

	return resp, nil
}

func buildContent(file multipart.File, mimeType string) ([]*genai.Content, error) {
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}

	return []*genai.Content{
		{
			Parts: []*genai.Part{
				genai.NewPartFromText("Here is the document you need to scan:"),
			},
			Role: genai.RoleUser,
		},
		{
			Parts: []*genai.Part{
				genai.NewPartFromBytes(data, mimeType),
			},
			Role: genai.RoleUser,
		},
	}, nil
}

func newGenerateContentConfig() *genai.GenerateContentConfig {
	return &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText(systemPrompt, ""),
		ResponseMIMEType:  "application/json",
		ThinkingConfig: &genai.ThinkingConfig{
			ThinkingLevel:   genai.ThinkingLevelHigh,
			IncludeThoughts: true,
		},
	}
}
