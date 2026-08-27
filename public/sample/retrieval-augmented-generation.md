# Retrieval-Augmented Generation: A Practical Primer

## 1 Scope

This note covers retrieval-augmented generation (RAG) as it is built in
practice: splitting a corpus into passages, embedding those passages as
vectors, retrieving the closest ones to a question, and passing them to a
language model as grounding context. It is written for engineers making
implementation choices, not as a survey of the research literature.

Fine-tuning, agentic tool use and multi-hop reasoning are out of scope. So is
evaluation methodology, which deserves its own treatment.

## 2 Why retrieval at all

A language model's parameters are fixed at training time. Anything learned
after the training cutoff, anything private to an organisation, and anything
too specific to have been memorised is simply not available to the model.

Retrieval sidesteps this. Rather than trying to put knowledge *into* the
model, the relevant passage is placed in front of it at question time. Three
properties follow, and they are the reason the pattern is so widely adopted:

The corpus can change without retraining. Adding a document is an insert, not
a training run.

Answers become attributable. Because the model was handed specific passages,
those passages can be shown to the reader, who can check them. A model
answering from parameters alone can offer no such receipt.

Cost scales with the corpus, not with the model. Indexing is a one-off per
document, and retrieval touches only a handful of passages per question.

## 3 The pipeline

A RAG system is five steps, and each one can be got wrong independently.

**Extraction** turns a source file into text. PDFs are the difficult case: a
PDF is a description of marks on a page, not a document structure, so reading
order, columns and tables all have to be inferred. A scanned PDF has no text
layer at all and needs OCR before anything else can happen.

**Chunking** splits that text into passages. This is the step most often
treated as trivial and most often responsible for poor results.

**Embedding** maps each passage to a vector, such that passages with similar
meanings land near each other.

**Retrieval** embeds the question the same way and finds the nearest passages
by vector distance.

**Generation** passes those passages to the model with instructions to answer
only from them.

## 4 Chunking strategies

Fixed-size chunking splits every N characters or tokens. It is trivial to
implement and it reliably cuts sentences in half, separating a claim from the
number that supports it.

Recursive splitting tries a series of separators in order — paragraphs, then
sentences, then words — falling back only when a piece is still too large. It
respects structure where structure exists.

Structural chunking splits on the document's own boundaries: Markdown
headings, HTML sections, PDF pages. It produces the most coherent passages
when the document is well structured and degrades to a single enormous chunk
when it is not.

Overlap is orthogonal to all three. Carrying the tail of one chunk into the
head of the next costs storage and buys insurance against a fact that
straddles a boundary becoming unretrievable.

The practical guidance is unglamorous: chunk on structure where it exists,
fall back to recursive splitting, and keep a modest overlap. Passages should
be large enough to carry a complete thought and small enough that a retrieved
passage is mostly relevant rather than mostly padding.

## 5 Embedding models

An embedding model is characterised by its output dimension, its context
window, and where it runs.

Dimension sets storage and search cost. `gte-small` produces 384-dimensional
vectors; OpenAI's `text-embedding-3-small` produces 1536. A larger vector is
not automatically better — it costs four times the storage per passage here,
and the benefit depends entirely on the corpus.

Context window sets the largest passage that can be embedded without
truncation. Many widely used encoders derive from BERT and inherit its
512-token limit, which silently caps how large a chunk can usefully be.

Where the model runs matters more than it first appears. A hosted embedding
API is one HTTP call but introduces a per-token cost and a dependency on an
external service being available at index time. A model running locally —
through ONNX Runtime, for instance — has no marginal cost and no network
dependency, at the price of loading weights into the process.

Whatever the choice, the same model must be used for indexing and for
querying. Vectors from two different models are not comparable, and mixing
them produces retrieval that fails quietly rather than loudly.

## 6 Vector search

Exact nearest-neighbour search compares the query against every stored vector.
It is perfectly accurate and linear in corpus size, which is fine for
thousands of passages and not for millions.

Approximate nearest-neighbour indexes trade a little recall for a large speed
gain. Two families dominate in Postgres via the pgvector extension.

IVFFlat partitions vectors into lists and searches only the nearest few. It
must be built on data that already exists, because the partitions are learned
from the vectors present at build time.

HNSW builds a navigable multi-layer graph. It generally offers better recall
at a given speed than IVFFlat and needs no training pass, which suits a system
where documents are indexed as they arrive rather than in a nightly batch.
pgvector added HNSW support in version 0.5.0.

Cosine distance is the usual choice for text embeddings. When vectors are
stored L2-normalised, cosine similarity is exactly `1 - cosine_distance`,
which makes the score directly interpretable.

## 7 Grounding and citation

Retrieval alone does not make an answer trustworthy. Two disciplines do.

The first is instructing the model to answer only from the supplied passages
and to say so when they do not contain the answer. A system that always
produces a confident answer has simply moved the failure from visible to
invisible.

The second is resolving citations server-side. If the model is asked to write
"page 14 of the annual report", it will write something plausible whether or
not it is true. If it is instead asked only to reference a passage it was
given, and the application maps that reference back to the stored location,
the citation cannot be wrong about where it came from. Any reference the
model produces that does not correspond to a retrieved passage should be
discarded rather than displayed.

A similarity floor matters here too. Passing weakly matching passages to the
model invites a confident answer assembled from material that does not
actually address the question. Returning "nothing here answers that" is a
better outcome, and should be treated as a normal answer rather than an error.

## 8 Recommendations

Chunk on the document's own structure before reaching for fixed-size splits.

Keep a modest overlap between adjacent chunks so a fact spanning a boundary
stays retrievable.

Record each chunk's origin — section, page or line range — at index time,
while the text is still adjacent to its source.

Use one embedding model for both indexing and querying, and re-index whenever
it changes.

Store vectors normalised and index them for cosine distance.

Set a similarity floor, and return an explicit "not found" below it rather
than answering from weak matches.

Resolve every citation server-side against stored records, and drop any
reference that does not resolve.
