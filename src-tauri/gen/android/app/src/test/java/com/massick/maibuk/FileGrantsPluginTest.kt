package com.massick.maibuk

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FileGrantsPluginTest {
  private val known = mapOf(
    "pdf" to "application/pdf",
    "epub" to "application/epub+zip",
    "jpg" to "image/jpeg",
    "jpeg" to "image/jpeg",
  )

  @Test
  fun filtersToTheTypesTheExtensionsName() {
    assertEquals(
      listOf("application/pdf", "application/epub+zip"),
      pickerMimeTypes(listOf("pdf", "epub")) { known[it] },
    )
  }

  @Test
  fun namesEachTypeOnce() {
    assertEquals(listOf("image/jpeg"), pickerMimeTypes(listOf("jpg", "jpeg")) { known[it] })
  }

  // Android 8 names no type for cbz, and its providers report such a file as
  // application/octet-stream; filtering that out greyed the file in the picker.
  @Test
  fun anUnknownExtensionAddsTheGenericTypeBesideTheKnownOnes() {
    assertEquals(
      listOf("application/pdf", "application/octet-stream"),
      pickerMimeTypes(listOf("pdf", "fb2", "cbz")) { known[it] },
    )
  }

  @Test
  fun aKnownExtensionAfterAnUnknownOneStillFilters() {
    assertEquals(
      listOf("application/octet-stream", "application/pdf"),
      pickerMimeTypes(listOf("cbz", "pdf")) { known[it] },
    )
  }

  @Test
  fun extensionsThePlatformCannotNameDropTheFilter() {
    assertEquals(emptyList<String>(), pickerMimeTypes(listOf("fb2", "cbz")) { known[it] })
  }

  @Test
  fun noExtensionsMeansNoFilter() {
    assertEquals(emptyList<String>(), pickerMimeTypes(emptyList()) { known[it] })
  }

  @Test
  fun aReportedSizeWinsAndNothingElseIsAsked() {
    var asked = 0
    assertEquals(9L, documentSize(9L, { asked++; 42L }, { asked++; 1L }, measure = true))
    assertEquals(0L, documentSize(0L, { asked++; 42L }, { asked++; 1L }, measure = false))
    assertEquals(0, asked)
  }

  @Test
  fun aMissingSizeFallsThroughToTheDescriptor() {
    var counted = 0
    assertEquals(42L, documentSize(null, { 42L }, { counted++; 7L }, measure = true))
    assertEquals(42L, documentSize(-1L, { 42L }, { counted++; 7L }, measure = false))
    assertEquals(0, counted)
  }

  @Test
  fun aPickCountsTheBytesWhenTheProviderReportsNoSize() {
    var counted = 0
    assertEquals(70_000L, documentSize(-1L, { -1L }, { counted++; 70_000L }, measure = true))
    assertEquals(1, counted)
  }

  @Test
  fun aPickWhoseDocumentCannotBeCountedHasNoSize() {
    assertNull(documentSize(null, { null }, { null }, measure = true))
    assertNull(documentSize(-1L, { -1L }, { null }, measure = true))
  }

  @Test
  fun aStatLeavesASizeNobodyReportsUnknown() {
    var counted = 0
    assertNull(documentSize(null, { -1L }, { counted++; 1L }, measure = false))
    assertEquals(0, counted)
  }

  @Test
  fun countsTheBytesOffAStream() {
    val bytes = ByteArray(70_000) { (it % 251).toByte() }
    assertEquals(70_000L, countBytes(ByteArrayInputStream(bytes)))
  }

  @Test
  fun countsAnEmptyDocumentAsZero() {
    assertEquals(0L, countBytes(ByteArrayInputStream(ByteArray(0))))
  }

  @Test
  fun matchesAnExtensionRegardlessOfCase() {
    assertTrue(matchesExtension("B.EPUB", listOf("epub")))
    assertTrue(matchesExtension("c.EpUb", listOf("epub")))
  }

  @Test
  fun matchesTheLastExtensionOfAMultiDotName() {
    assertTrue(matchesExtension("Vol 1.final.epub", listOf("epub")))
  }

  @Test
  fun leavesOutAnotherExtension() {
    assertFalse(matchesExtension("notes.txt", listOf("epub", "pdf")))
    assertFalse(matchesExtension("book.epub.part", listOf("epub")))
  }

  @Test
  fun aDotFileHasNoExtension() {
    assertFalse(matchesExtension(".epub", listOf("epub")))
  }

  @Test
  fun aSinglePickIsItsDataUri() {
    assertEquals(listOf("content://a/1"), pickedUris("content://a/1", emptyList()))
  }

  @Test
  fun aMultiPickIsEveryClipUriInPickedOrder() {
    assertEquals(
      listOf("content://a/1", "content://a/2", "content://a/3"),
      pickedUris(null, listOf("content://a/1", "content://a/2", "content://a/3")),
    )
  }

  @Test
  fun clipDataWinsOverTheDataUri() {
    assertEquals(listOf("content://a/2"), pickedUris("content://a/1", listOf("content://a/2")))
  }

  @Test
  fun aPickListedTwiceAppearsOnce() {
    assertEquals(
      listOf("content://a/1", "content://a/2"),
      pickedUris(null, listOf("content://a/1", "content://a/2", "content://a/1")),
    )
  }

  @Test
  fun aCancelledPickHasNoUris() {
    assertEquals(emptyList<String>(), pickedUris<String>(null, emptyList()))
  }

  @Test
  fun aNameWithNoExtensionNeverMatches() {
    assertFalse(matchesExtension("epub", listOf("epub")))
    assertFalse(matchesExtension("book.", listOf("epub")))
  }
}
