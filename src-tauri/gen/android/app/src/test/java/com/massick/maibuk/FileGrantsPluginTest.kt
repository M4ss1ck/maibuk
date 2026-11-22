package com.massick.maibuk

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

  @Test
  fun anUnknownExtensionLeavesTheKnownTypesFiltering() {
    assertEquals(
      listOf("application/pdf"),
      pickerMimeTypes(listOf("pdf", "fb2", "cbz")) { known[it] },
    )
  }

  @Test
  fun aKnownExtensionAfterAnUnknownOneStillFilters() {
    assertEquals(
      listOf("application/pdf"),
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
}
