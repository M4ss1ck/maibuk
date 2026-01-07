import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBookStore } from "../features/books/store";
import { BookCard } from "../components/project/BookCard";
import { NewBookDialog } from "../components/project/NewBookDialog";
import { Button } from "../components/ui/Button";

export function Home() {
  const navigate = useNavigate();
  const [isNewBookOpen, setIsNewBookOpen] = useState(false);

  const { books, isLoading, loadBooks } = useBookStore();

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const handleBookCreated = (bookId: string) => {
    navigate(`/book/${bookId}`);
  };

  if (isLoading && books.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-semibold">Your Books</h2>
        <Button onClick={() => setIsNewBookOpen(true)}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Book
        </Button>
      </div>

      {books.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-24 h-24 mb-6 rounded-full bg-muted flex items-center justify-center">
            <svg className="w-12 h-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h3 className="text-xl font-medium mb-2">No books yet</h3>
          <p className="text-muted-foreground mb-6 max-w-md">
            Start your writing journey by creating your first book. Add chapters, design a cover, and export to EPUB or PDF.
          </p>
          <Button size="lg" onClick={() => setIsNewBookOpen(true)}>
            Create Your First Book
          </Button>
        </div>
      ) : (
        /* Book grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => navigate(`/book/${book.id}`)}
            />
          ))}
        </div>
      )}

      <NewBookDialog
        isOpen={isNewBookOpen}
        onClose={() => setIsNewBookOpen(false)}
        onSuccess={handleBookCreated}
      />
    </div>
  );
}
