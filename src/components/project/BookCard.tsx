import type { Book } from "../../features/books/types";

interface BookCardProps {
  book: Book;
  onClick: () => void;
}

export function BookCard({ book, onClick }: BookCardProps) {
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const statusColors = {
    draft: "bg-gray-100 text-gray-600",
    "in-progress": "bg-blue-100 text-blue-600",
    completed: "bg-green-100 text-green-600",
  };

  return (
    <button
      onClick={onClick}
      className="flex flex-col bg-white border border-[var(--color-border)] rounded-xl overflow-hidden hover:shadow-lg transition-shadow text-left w-full"
    >
      {/* Cover placeholder */}
      <div className="aspect-[2/3] bg-gradient-to-br from-[var(--color-border)] to-gray-200 flex items-center justify-center">
        {book.coverImagePath ? (
          <img
            src={book.coverImagePath}
            alt={book.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <svg className="w-16 h-16 text-[var(--color-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-semibold text-lg truncate">{book.title}</h3>
        <p className="text-sm text-[var(--color-muted)] truncate">{book.authorName}</p>

        <div className="flex items-center justify-between mt-3">
          <span className={`text-xs px-2 py-1 rounded-full capitalize ${statusColors[book.status]}`}>
            {book.status.replace("-", " ")}
          </span>
          <span className="text-xs text-[var(--color-muted)]">
            {book.wordCount.toLocaleString()} words
          </span>
        </div>

        <p className="text-xs text-[var(--color-muted)] mt-2">
          Updated {formatDate(book.updatedAt)}
        </p>
      </div>
    </button>
  );
}
